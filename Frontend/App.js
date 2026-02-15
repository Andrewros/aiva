import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
	View,
	Text,
	StyleSheet,
	Dimensions,
	ActivityIndicator,
	FlatList,
	TouchableWithoutFeedback,
	TouchableOpacity,
	StatusBar,
	Animated,
	Easing,
	TextInput,
	Image,
	Modal,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import CommentsSection from "./CommentsSection";

// Screen size used to size pages/videos for a full-screen vertical feed.
const { height: H, width: W } = Dimensions.get("window");
function resolveApiBaseUrl(rawValue) {
	const value = String(rawValue || "").trim().replace(/\/+$/, "");
	if (!value) return "http://localhost:3001";
	if (/^https?:\/\//i.test(value)) return value;
	return `http://${value}`;
}

const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
const AUTH_SESSION_STORAGE_KEY = "aiva_auth_session_v1";

// 1534 -> "1.5k", supports up to trillions.
function convertNumberToLetter(num) {
	if (num == null || Number.isNaN(num)) return "";

	const n = Number(num);
	if (!Number.isFinite(n)) return String(num);

	const sign = n < 0 ? "-" : "";
	const abs = Math.abs(n);

	if (abs < 1000) return sign + String(abs);

	const units = [
		{ value: 1e12, suffix: "T" },
		{ value: 1e9, suffix: "B" },
		{ value: 1e6, suffix: "M" },
		{ value: 1e3, suffix: "k" },
	];

	let unit = units[units.length - 1];
	for (const u of units) {
		if (abs >= u.value) {
			unit = u;
			break;
		}
	}

	const scaled = abs / unit.value;
	let rounded = Math.round(scaled * 10) / 10;

	const idx = units.findIndex((u) => u.value === unit.value);
	if (rounded >= 1000 && idx > 0) {
		const next = units[idx - 1];
		rounded = Math.round((abs / next.value) * 10) / 10;
		return sign + formatOneDecimal(rounded) + next.suffix;
	}

	return sign + formatOneDecimal(rounded) + unit.suffix;

	function formatOneDecimal(x) {
		const s = x.toFixed(1);
		return s.endsWith(".0") ? s.slice(0, -2) : s;
	}
}

function normalizeForSearch(value) {
	if (!value) return "";
	return String(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function textMatchesQuery(query, text) {
	const normalizedQuery = normalizeForSearch(query);
	if (!normalizedQuery) return false;
	const normalizedText = normalizeForSearch(text);
	if (!normalizedText) return false;

	const tokens = normalizedQuery.split(" ").filter(Boolean);
	return tokens.every((token) => normalizedText.includes(token));
}

function getSearchMatchesInOrder(items, query) {
	if (!query.trim()) return items;

	const checks = [
		{ label: "username", getText: (post) => post.username },
		{ label: "caption", getText: (post) => post.caption },
		{ label: "audio", getText: (post) => post.audio },
		{
			label: "captions",
			getText: (post) => (post.comments ?? []).map((c) => c.text).join(" "),
		},
	];

	const matchedIds = new Set();
	const orderedMatches = [];

	for (const check of checks) {
		for (const post of items) {
			if (matchedIds.has(post.id)) continue;
			if (textMatchesQuery(query, check.getText(post))) {
				matchedIds.add(post.id);
				orderedMatches.push(post);
			}
		}
	}

	return orderedMatches;
}

function normalizeFeedItems(items) {
	if (!Array.isArray(items)) return [];

	const normalized = [];
	for (const raw of items) {
		const id = String(raw?.id ?? "").trim();
		const uri = String(raw?.uri ?? raw?.videoUrl ?? raw?.url ?? "").trim();
		if (!id || !uri) continue;

		const comments = Array.isArray(raw?.comments) ? raw.comments : [];
		const commentsCount =
			Number(raw?.commentsCount ?? raw?.comments_count) || comments.length;

		normalized.push({
			id,
			username: String(raw?.username ?? "unknown"),
			caption: String(raw?.caption ?? ""),
			audio: String(raw?.audio ?? ""),
			uri,
			poster: String(raw?.poster ?? raw?.posterUrl ?? "").trim(),
			likes: Number(raw?.likes) || 0,
			comments,
			commentsCount,
		});
	}

	return normalized;
}

function FollowButton({
	username,
	currentUser,
	followedUsersRef,
	onToggleFollow,
}) {
	const [isFollowed, setIsFollowed] = useState(() =>
		followedUsersRef.current.has(username)
	);
	const isSelf = username === currentUser;

	useEffect(() => {
		setIsFollowed(followedUsersRef.current.has(username));
	}, [username, followedUsersRef]);

	const onPress = useCallback(() => {
		if (isSelf) return;
		setIsFollowed((prev) => !prev);
		onToggleFollow(username);
	}, [isSelf, onToggleFollow, username]);

	return (
		<TouchableOpacity
			activeOpacity={0.85}
			onPress={onPress}
			style={[
				styles.followButton,
				isFollowed && styles.followButtonUnfollow,
				isSelf && styles.followButtonDisabled,
			]}
			disabled={isSelf}
		>
			<Text
				style={[
					styles.followButtonText,
					isFollowed && styles.followButtonTextUnfollow,
					isSelf && styles.followButtonTextDisabled,
				]}
			>
				{isSelf ? "You" : isFollowed ? "Unfollow" : "Follow"}
			</Text>
		</TouchableOpacity>
	);
}

// Renders a single full-screen video cell with engagement actions.
function NativeVideoPost({
	item,
	active,
	likesCount,
	onToggleLike,
	onOpenComments,
	onToggleFollow,
	followedUsersRef,
	currentUser,
}) {
	// Create a video player instance per item.
	const player = useVideoPlayer(item.uri, (player) => {
		player.loop = true;
		player.muted = false;
	});

	const [paused, setPaused] = useState(false);

	// Like pop animation state.
	const likePop = useRef(new Animated.Value(0)).current;

	const runLikePop = useCallback(() => {
		likePop.stopAnimation();
		likePop.setValue(0);
		Animated.sequence([
			Animated.timing(likePop, {
				toValue: 1,
				duration: 140,
				easing: Easing.out(Easing.cubic),
				useNativeDriver: true,
			}),
			Animated.timing(likePop, {
				toValue: 0,
				duration: 220,
				delay: 80,
				easing: Easing.in(Easing.cubic),
				useNativeDriver: true,
			}),
		]).start();
	}, [likePop]);

	// Play/pause icon overlay animation.
	const playPauseOpacity = useRef(new Animated.Value(0)).current;
	const playPauseScale = useRef(new Animated.Value(1)).current;
	const hideTimerRef = useRef(null);

	// Show the overlay and optionally auto-hide it for "play".
	const showPlayPauseIcon = useCallback(
		(mode) => {
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current);
				hideTimerRef.current = null;
			}

			playPauseOpacity.stopAnimation();
			playPauseScale.stopAnimation();

			playPauseScale.setValue(0.9);
			playPauseOpacity.setValue(0);

			Animated.parallel([
				Animated.timing(playPauseOpacity, {
					toValue: 1,
					duration: 120,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(playPauseScale, {
					toValue: 1,
					duration: 120,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
			]).start();

			if (mode === "play") {
				hideTimerRef.current = setTimeout(() => {
					Animated.timing(playPauseOpacity, {
						toValue: 0,
						duration: 180,
						easing: Easing.in(Easing.cubic),
						useNativeDriver: true,
					}).start();
				}, 500);
			}
		},
		[playPauseOpacity, playPauseScale]
	);

	useEffect(() => {
		// Cleanup any pending hide timer on unmount.
		return () => {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, []);

	// Auto-play only when visible in the list.
	useEffect(() => {
		if (active) {
			player.play();
			setPaused(false);
		} else {
			player.pause();
			player.currentTime = 0;
			setPaused(false);
			playPauseOpacity.setValue(0);
		}
	}, [active, player, playPauseOpacity]);

	const onToggleVideo = useCallback(() => {
		// Tap-to-toggle playback and show the overlay.
		if (paused) {
			player.play();
			setPaused(false);
			showPlayPauseIcon("play");
		} else {
			player.pause();
			setPaused(true);
			showPlayPauseIcon("pause");
		}
	}, [paused, player, showPlayPauseIcon]);

	// Like toggling updates App state and triggers a pop animation.
	const onPressLike = useCallback(() => {
		onToggleLike(item.id);
		runLikePop();
	}, [item.id, onToggleLike, runLikePop]);

	return (
		<View style={styles.page}>
			<TouchableWithoutFeedback onPress={onToggleVideo}>
				<View style={StyleSheet.absoluteFill}>
					<VideoView
						style={styles.video}
						player={player}
						contentFit="cover"
						nativeControls={false}
					/>
				</View>
			</TouchableWithoutFeedback>

			<Animated.View
				pointerEvents="none"
				style={[
					styles.playPauseOverlay,
					{
						opacity: playPauseOpacity,
						transform: [{ scale: playPauseScale }],
					},
				]}
			>
				<Text style={styles.playPauseIcon}>{paused ? "▶" : "❚❚"}</Text>
			</Animated.View>

			<View style={styles.rightRail} pointerEvents="box-none">
				{/* Like button */}
				<TouchableOpacity
					activeOpacity={0.85}
					onPress={onPressLike}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					{/* Heart filled if this post is liked in app state. */}
					<Text style={[styles.icon, item.isLiked && styles.iconLiked]}>
						{item.isLiked ? "♥" : "♡"}
					</Text>

					{/* Show updated like count from state. */}
					<Text style={styles.count}>{convertNumberToLetter(likesCount)}</Text>
				</TouchableOpacity>

				{/* Comments button */}
				<TouchableOpacity
					activeOpacity={0.85}
					onPress={() => onOpenComments(item.id)}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					<Text style={styles.icon}>💬</Text>
					<Text style={styles.count}>
						{convertNumberToLetter(
							item.commentsCount ?? item.comments?.length ?? 0
						)}
					</Text>
				</TouchableOpacity>

				{/* Share button placeholder */}
				<TouchableOpacity
					activeOpacity={0.85}
					onPress={() => console.log("share")}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					<Text style={styles.icon}>↗</Text>
					<Text style={styles.count}>Share</Text>
				</TouchableOpacity>
			</View>

			{/* Like pop animation overlay */}
			<Animated.View
				pointerEvents="none"
				style={[
					styles.likePop,
					{
						opacity: likePop,
						transform: [
							{
								scale: likePop.interpolate({
									inputRange: [0, 1],
									outputRange: [0.6, 1.2],
								}),
							},
						],
					},
				]}
			>
				<Text style={styles.likePopText}>♥</Text>
			</Animated.View>

			{/* Post metadata */}
			<View style={styles.bottomMeta} pointerEvents="box-none">
				<View style={styles.usernameRow}>
					<Text style={styles.username}>@{item.username}</Text>
					<FollowButton
						username={item.username}
						currentUser={currentUser}
						followedUsersRef={followedUsersRef}
						onToggleFollow={onToggleFollow}
					/>
				</View>
				<Text style={styles.caption}>{item.caption}</Text>
				<Text style={styles.audio}>♫ {item.audio}</Text>
			</View>
		</View>
	);
}

function VideoPost(props) {
	return <NativeVideoPost {...props} />;
}

export default function App() {
	const [authBooting, setAuthBooting] = useState(true);
	const [authToken, setAuthToken] = useState(null);
	const [authUser, setAuthUser] = useState(null);
	const [authMode, setAuthMode] = useState("login");
	const [authStep, setAuthStep] = useState("credentials");
	const [authPhone, setAuthPhone] = useState("");
	const [authPassword, setAuthPassword] = useState("");
	const [authUsername, setAuthUsername] = useState("");
	const [authCode, setAuthCode] = useState("");
	const [authBusy, setAuthBusy] = useState(false);
	const [authError, setAuthError] = useState(null);
	const [authDebugCode, setAuthDebugCode] = useState("");
	const currentUser = authUser?.username ?? "";
	const currentUserId = authUser?.id ?? "";
	// Active index controls which item should auto-play.
	const [activeIndex, setActiveIndex] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [feedFilter, setFeedFilter] = useState("all");
	const [isFeedVisible, setIsFeedVisible] = useState(true);
	const [isLoadingFeed, setIsLoadingFeed] = useState(true);
	const [feedError, setFeedError] = useState(null);
	const pagerRef = useRef(null);
	const feedListRef = useRef(null);
	const lastFeedEntryRef = useRef("manual");
	const [pendingFeedIndex, setPendingFeedIndex] = useState(null);
	const [isGeneratingAiva, setIsGeneratingAiva] = useState(false);
	const [isAivaPromptOpen, setIsAivaPromptOpen] = useState(false);
	const [aivaTitle, setAivaTitle] = useState("");
	const [aivaPromptText, setAivaPromptText] = useState("");
	const [aivaImageUrlInput, setAivaImageUrlInput] = useState("");
	const [aivaImages, setAivaImages] = useState([]);
	const [aivaDuration, setAivaDuration] = useState(10);
	const [aivaError, setAivaError] = useState(null);
	const [isAivaWaiting, setIsAivaWaiting] = useState(false);
	const [aivaProgress, setAivaProgress] = useState(0);
	const [isResettingUploads, setIsResettingUploads] = useState(false);
	const aivaPollRef = useRef(null);
	const aivaProgressTimerRef = useRef(null);

	// Local feed state to store per-item likes and comments.
	const [feed, setFeed] = useState([]);

	const apiFetch = useCallback(async (path, options = {}) => {
		const headers = { ...(options.headers || {}) };
		if (authToken && !headers.Authorization) {
			headers.Authorization = `Bearer ${authToken}`;
		}
		try {
			return await fetch(`${API_BASE_URL}${path}`, {
				...options,
				headers,
			});
		} catch (error) {
			throw new Error(
				`Network error reaching API (${API_BASE_URL}): ${
					error?.message || String(error)
				}`
			);
		}
	}, [authToken]);

	const persistAuthSession = useCallback(async (token, user) => {
		const payload = { token, user };
		await AsyncStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(payload));
		setAuthToken(token);
		setAuthUser(user);
	}, []);

	const clearAuthSession = useCallback(async () => {
		setAuthToken(null);
		setAuthUser(null);
		setAuthStep("credentials");
		setAuthError(null);
		setAuthDebugCode("");
		await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
	}, []);

	useEffect(() => {
		const hydrateAuth = async () => {
			try {
				const raw = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
				if (!raw) {
					setAuthBooting(false);
					return;
				}
				const parsed = JSON.parse(raw);
				if (!parsed?.token) {
					setAuthBooting(false);
					return;
				}
				const response = await fetch(`${API_BASE_URL}/auth/me`, {
					headers: { Authorization: `Bearer ${parsed.token}` },
				});
				if (!response.ok) {
					await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
					setAuthBooting(false);
					return;
				}
				const data = await response.json();
				setAuthToken(parsed.token);
				setAuthUser(data?.user || null);
			} catch {
				await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
			} finally {
				setAuthBooting(false);
			}
		};
		hydrateAuth();
	}, []);

	const hydrateFeed = useCallback((items) => {
		return items.map((p) => ({
			...p,
			isLiked: false,
			likesCount: p.likes,
		}));
	}, []);

	const loadFeed = useCallback(async () => {
		setIsLoadingFeed(true);
		setFeedError(null);

		try {
			const response = await apiFetch(
				`/feed?userId=${encodeURIComponent(currentUserId)}`
			);
			if (!response.ok) {
				throw new Error(`Feed request failed (${response.status})`);
			}
			const data = await response.json();
			const normalized = normalizeFeedItems(data);
			setFeed(hydrateFeed(normalized));
		} catch (error) {
			setFeed([]);
			setFeedError(error?.message ?? "Failed to load feed.");
		} finally {
			setIsLoadingFeed(false);
		}
	}, [apiFetch, currentUserId, hydrateFeed]);

	useEffect(() => {
		if (!authUser || !authToken) return;
		loadFeed();
	}, [authToken, authUser, loadFeed]);

	useEffect(() => {
		return () => {
			if (aivaPollRef.current) {
				clearInterval(aivaPollRef.current);
				aivaPollRef.current = null;
			}
			if (aivaProgressTimerRef.current) {
				clearInterval(aivaProgressTimerRef.current);
				aivaProgressTimerRef.current = null;
			}
		};
	}, []);

	const addAivaImageUrl = useCallback(() => {
		const trimmed = aivaImageUrlInput.trim();
		if (!trimmed) return;
		setAivaImages([
			{ id: `${Date.now()}-${Math.random()}`, type: "url", uri: trimmed },
		]);
		setAivaImageUrlInput("");
	}, [aivaImageUrlInput]);

	const removeAivaImage = useCallback((id) => {
		setAivaImages((prev) => prev.filter((img) => img.id !== id));
	}, []);

	const startAivaPolling = useCallback(() => {
		if (aivaPollRef.current) {
			clearInterval(aivaPollRef.current);
		}
		if (aivaProgressTimerRef.current) {
			clearInterval(aivaProgressTimerRef.current);
		}
		aivaProgressTimerRef.current = setInterval(() => {
			setAivaProgress((prev) => (prev >= 95 ? prev : prev + 3));
		}, 1000);

		aivaPollRef.current = setInterval(async () => {
			try {
				const response = await apiFetch(
					`/aiva/status?userId=${encodeURIComponent(currentUserId)}`
				);
				if (!response.ok) return;
				const data = await response.json();
				const status = data?.job?.status;
				if (status === "succeeded") {
					clearInterval(aivaPollRef.current);
					aivaPollRef.current = null;
					if (aivaProgressTimerRef.current) {
						clearInterval(aivaProgressTimerRef.current);
						aivaProgressTimerRef.current = null;
					}
					setAivaProgress(100);
					await loadFeed();
					setTimeout(() => {
						setIsAivaWaiting(false);
						setAivaProgress(0);
					}, 250);
				}
				if (status === "failed" || status === "blocked") {
					clearInterval(aivaPollRef.current);
					aivaPollRef.current = null;
					if (aivaProgressTimerRef.current) {
						clearInterval(aivaProgressTimerRef.current);
						aivaProgressTimerRef.current = null;
					}
					setIsAivaWaiting(false);
					setAivaProgress(0);
					setAivaError(data?.job?.error || "AIVA generation failed.");
				}
			} catch (error) {
				// keep polling
			}
		}, 5000);
	}, [apiFetch, currentUserId, loadFeed]);

	const handlePickAivaImage = useCallback(async () => {
		const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
		if (permission.status !== "granted") {
			setAivaError("Photo access is required to pick an image.");
			return;
		}

		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ImagePicker.MediaTypeOptions.Images,
			allowsEditing: true,
			quality: 0.9,
		});

		if (result.canceled) return;
		const asset = result.assets?.[0];
		if (!asset?.uri) return;

		setAivaImages([
			{
				id: `${Date.now()}-${Math.random()}`,
				type: "local",
				uri: asset.uri,
				name: asset.fileName,
				mimeType: asset.mimeType,
			},
		]);
	}, []);

	const uploadAivaImagesIfNeeded = useCallback(async () => {
		const img = aivaImages.find((item) => item.type === "local");
		if (!img) return null;

		const name = img.name || img.uri.split("/").pop();
		const type = img.mimeType || "image/jpeg";

		const formData = new FormData();
		formData.append("image", {
			uri: img.uri,
			name: name || "aiva.jpg",
			type,
		});

		const response = await apiFetch("/aiva/prompt-image", {
			method: "POST",
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`Image upload failed (${response.status})`);
		}

		const data = await response.json();
		return data?.imageUrl || null;
	}, [aivaImages, apiFetch]);

	const handleGenerateAiva = useCallback(async () => {
		if (isGeneratingAiva) return;
		setIsGeneratingAiva(true);
		setAivaError(null);
		setAivaProgress(5);

		try {
			const trimmedTitle = aivaTitle.trim();
			if (!trimmedTitle) {
				throw new Error("Title is required.");
			}

			const selectedImage = aivaImages[0];
			if (!selectedImage) {
				throw new Error("Provide one image (URL or photo).");
			}

			let finalImageUrl = null;
			if (selectedImage.type === "url") {
				finalImageUrl = selectedImage.uri;
			} else {
				finalImageUrl = await uploadAivaImagesIfNeeded();
			}

			if (!finalImageUrl) {
				throw new Error("Could not prepare image for generation.");
			}

			setIsAivaWaiting(true);
			const response = await apiFetch("/aiva/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userId: currentUserId,
					title: trimmedTitle,
					promptText: aivaPromptText.trim(),
					imageUrls: [finalImageUrl],
					duration: Number(aivaDuration),
				}),
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.error || `AIVA request failed (${response.status})`);
			}
			startAivaPolling();
			setAivaTitle("");
			setIsAivaPromptOpen(false);
		} catch (error) {
			setIsAivaWaiting(false);
			setAivaProgress(0);
			setAivaError(error?.message ?? "AIVA generation failed.");
			console.warn("AIVA generation failed:", error);
		} finally {
			setIsGeneratingAiva(false);
		}
	}, [
		aivaDuration,
		aivaImages,
		aivaPromptText,
		aivaTitle,
		apiFetch,
		currentUserId,
		isGeneratingAiva,
		uploadAivaImagesIfNeeded,
	]);

	const handleResetUploadCount = useCallback(async () => {
		if (isResettingUploads || currentUserId !== "andrew") return;
		setIsResettingUploads(true);
		setAivaError(null);
		try {
			const response = await apiFetch("/aiva/reset-upload-count", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId: currentUserId }),
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.error || `Reset failed (${response.status})`);
			}
			await loadFeed();
		} catch (error) {
			setAivaError(error?.message ?? "Failed to reset upload count.");
		} finally {
			setIsResettingUploads(false);
		}
	}, [apiFetch, currentUserId, isResettingUploads, loadFeed]);

	const handleStartRegister = useCallback(async () => {
		setAuthBusy(true);
		setAuthError(null);
		setAuthDebugCode("");
		try {
			const response = await apiFetch("/auth/register/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					phone: authPhone.trim(),
					password: authPassword,
				}),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Register failed (${response.status})`);
			}
			setAuthStep("otp");
			setAuthDebugCode(String(body?.devOtp || ""));
		} catch (error) {
			setAuthError(error?.message ?? "Failed to start registration.");
		} finally {
			setAuthBusy(false);
		}
	}, [apiFetch, authPassword, authPhone]);

	const handleVerifyRegister = useCallback(async () => {
		setAuthBusy(true);
		setAuthError(null);
		try {
			const response = await apiFetch("/auth/register/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					phone: authPhone.trim(),
					code: authCode.trim(),
					username: authUsername.trim(),
				}),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Verify failed (${response.status})`);
			}
			await persistAuthSession(body.token, body.user);
		} catch (error) {
			setAuthError(error?.message ?? "Failed to verify registration.");
		} finally {
			setAuthBusy(false);
		}
	}, [
		apiFetch,
		authCode,
		authPhone,
		authUsername,
		persistAuthSession,
	]);

	const handleStartLogin = useCallback(async () => {
		setAuthBusy(true);
		setAuthError(null);
		setAuthDebugCode("");
		try {
			const response = await apiFetch("/auth/login/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					phone: authPhone.trim(),
					password: authPassword,
				}),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Login failed (${response.status})`);
			}
			setAuthStep("otp");
			setAuthDebugCode(String(body?.devOtp || ""));
		} catch (error) {
			setAuthError(error?.message ?? "Failed to start login.");
		} finally {
			setAuthBusy(false);
		}
	}, [apiFetch, authPassword, authPhone]);

	const handleVerifyLogin = useCallback(async () => {
		setAuthBusy(true);
		setAuthError(null);
		try {
			const response = await apiFetch("/auth/login/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					phone: authPhone.trim(),
					code: authCode.trim(),
				}),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Verify failed (${response.status})`);
			}
			await persistAuthSession(body.token, body.user);
		} catch (error) {
			setAuthError(error?.message ?? "Failed to verify login.");
		} finally {
			setAuthBusy(false);
		}
	}, [apiFetch, authCode, authPhone, persistAuthSession]);

	const handleLogout = useCallback(async () => {
		try {
			await apiFetch("/auth/logout", { method: "POST" });
		} catch {
			// ignore network/logout failures; local session is source of truth for UI.
		}
		await clearAuthSession();
	}, [apiFetch, clearAuthSession]);

	// Toggle like: increment if not liked, decrement if liked.
	const toggleLikeById = useCallback((postId) => {
		setFeed((prev) =>
			prev.map((p) => {
				if (p.id !== postId) return p;

				const nextLiked = !p.isLiked;
				const base = p.likesCount ?? p.likes ?? 0;

				return {
					...p,
					isLiked: nextLiked,
					likesCount: Math.max(0, base + (nextLiked ? 1 : -1)),
				};
			})
		);
	}, []);

	// Follow state is kept in a ref to avoid forcing immediate re-renders.
	const followedUsersRef = useRef(new Set());

	const toggleFollowByUsername = useCallback((username) => {
		const next = new Set(followedUsersRef.current);
		if (next.has(username)) {
			next.delete(username);
		} else {
			next.add(username);
		}
		followedUsersRef.current = next;
	}, []);

	// Consider an item active once most of it is visible.
	const viewabilityConfig = useMemo(
		() => ({
			itemVisiblePercentThreshold: 80,
		}),
		[]
	);

	// Track the topmost visible item index.
	const onViewableItemsChanged = useRef(({ viewableItems }) => {
		if (!viewableItems.length) return;
		setActiveIndex(viewableItems[0].index);
	}).current;

	// Comments sheet state.
	const [commentsOpen, setCommentsOpen] = useState(false);
	const [commentsPostId, setCommentsPostId] = useState(null);

	// Open the comments sheet for a specific post.
	const openCommentsFor = useCallback((postId) => {
		setCommentsPostId(postId);
		setCommentsOpen(true);
	}, []);

	// Close comments sheet and clear selection after animation.
	const closeComments = useCallback(() => {
		setCommentsOpen(false);
		setTimeout(() => setCommentsPostId(null), 220);
	}, []);

	// Resolve the post shown in the comments sheet.
	const activeCommentsPost = useMemo(() => {
		return feed.find((p) => p.id === commentsPostId) ?? null;
	}, [feed, commentsPostId]);

	// Append a new comment to the active post.
	const addCommentToActivePost = useCallback(
		(text) => {
			if (!commentsPostId) return;

			setFeed((prev) =>
				prev.map((p) => {
					if (p.id !== commentsPostId) return p;

					const newComment = {
						id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
						user: "andrew", // TODO: replace with current user
						text,
						likes: 0,
						createdAt: new Date().toISOString(),
					};

					const nextComments = [newComment, ...(p.comments ?? [])];

					return {
						...p,
						comments: nextComments,
						commentsCount: (p.commentsCount ?? p.comments?.length ?? 0) + 1,
					};
				})
			);
		},
		[commentsPostId, setFeed]
	);

	const filteredFeed = useMemo(() => {
		const baseFeed =
			feedFilter === "user"
				? feed.filter((post) => post.username === currentUser)
				: feed;
		const matches = getSearchMatchesInOrder(baseFeed, searchQuery);
		if (!matches.length) return matches;

		const followed = matches.filter((post) =>
			followedUsersRef.current.has(post.username)
		);
		const others = matches.filter(
			(post) => !followedUsersRef.current.has(post.username)
		);
		return [...followed, ...others];
	}, [feed, feedFilter, searchQuery, currentUser]);

	useEffect(() => {
		setActiveIndex(0);
		if (filteredFeed.length > 0) {
			feedListRef.current?.scrollToIndex({ index: 0, animated: false });
		}
	}, [searchQuery, feedFilter, filteredFeed.length]);

	useEffect(() => {
		if (!filteredFeed.length) {
			setActiveIndex(0);
			return;
		}
		if (activeIndex >= filteredFeed.length) {
			setActiveIndex(0);
		}
	}, [activeIndex, filteredFeed.length]);

	const userVideos = useMemo(() => {
		return feed.filter((post) => post.username === currentUser);
	}, [feed, currentUser]);

	const handleProfileVideoPress = useCallback((index) => {
		lastFeedEntryRef.current = "profileVideo";
		setPendingFeedIndex(index);
		setFeedFilter("user");
		setSearchQuery("");
		setIsSearchOpen(false);
		pagerRef.current?.scrollToIndex({ index: 0, animated: true });
		if (Number.isInteger(index)) {
			setActiveIndex(index);
		} else {
			setActiveIndex(0);
		}
	}, []);

	useEffect(() => {
		if (feedFilter !== "user") return;
		if (!filteredFeed.length) return;
		if (pendingFeedIndex == null) return;

		const targetIndex = Math.min(
			Math.max(0, pendingFeedIndex),
			filteredFeed.length - 1
		);

		feedListRef.current?.scrollToIndex({
			index: targetIndex,
			animated: false,
		});
		setActiveIndex(targetIndex);
		setPendingFeedIndex(null);
	}, [feedFilter, filteredFeed.length, pendingFeedIndex]);

	const pages = useMemo(() => [{ key: "feed" }, { key: "profile" }], []);
	const pagerViewabilityConfig = useMemo(
		() => ({ itemVisiblePercentThreshold: 80 }),
		[]
	);
	const onPagerViewableItemsChanged = useRef(({ viewableItems }) => {
		if (!viewableItems.length) return;
		const visibleKey = viewableItems[0]?.item?.key;
		const isFeed = visibleKey === "feed";
		setIsFeedVisible(isFeed);
		if (isFeed) {
			if (lastFeedEntryRef.current !== "profileVideo") {
				setFeedFilter("all");
			}
			lastFeedEntryRef.current = "manual";
		}
	}).current;

	if (authBooting) {
		return (
			<View style={styles.authContainer}>
				<ActivityIndicator size="large" color="#ffffff" />
				<Text style={styles.authLoadingText}>Checking session...</Text>
			</View>
		);
	}

	if (!authUser) {
		const isRegister = authMode === "register";
		const isOtpStep = authStep === "otp";

		return (
			<View style={styles.authContainer}>
				<Text style={styles.authTitle}>Welcome to AIVA</Text>
				<Text style={styles.authSubtitle}>
					{isRegister ? "Create account" : "Sign in"} with phone + password, then
					verify with a phone code.
				</Text>
				<TextInput
					value={authPhone}
					onChangeText={setAuthPhone}
					placeholder="Phone number (+15551234567)"
					placeholderTextColor="rgba(255,255,255,0.5)"
					autoCapitalize="none"
					keyboardType="phone-pad"
					style={styles.authInput}
				/>
				<TextInput
					value={authPassword}
					onChangeText={setAuthPassword}
					placeholder="Password (min 8 chars)"
					placeholderTextColor="rgba(255,255,255,0.5)"
					secureTextEntry
					style={styles.authInput}
				/>
				{isRegister ? (
					<TextInput
						value={authUsername}
						onChangeText={setAuthUsername}
						placeholder="Unique username"
						placeholderTextColor="rgba(255,255,255,0.5)"
						autoCapitalize="none"
						style={styles.authInput}
					/>
				) : null}
				{isOtpStep ? (
					<TextInput
						value={authCode}
						onChangeText={setAuthCode}
						placeholder="6-digit verification code"
						placeholderTextColor="rgba(255,255,255,0.5)"
						keyboardType="number-pad"
						style={styles.authInput}
					/>
				) : null}
				{authDebugCode ? (
					<Text style={styles.authDevCode}>
						Dev OTP: {authDebugCode}
					</Text>
				) : null}
				{authError ? <Text style={styles.authError}>{authError}</Text> : null}
				<TouchableOpacity
					onPress={
						isOtpStep
							? isRegister
								? handleVerifyRegister
								: handleVerifyLogin
							: isRegister
								? handleStartRegister
								: handleStartLogin
					}
					disabled={authBusy}
					style={[styles.authPrimaryButton, authBusy && styles.authButtonDisabled]}
					activeOpacity={0.9}
				>
					<Text style={styles.authPrimaryButtonText}>
						{authBusy
							? "Please wait..."
							: isOtpStep
								? "Verify Code"
								: isRegister
									? "Send Verification Code"
									: "Send Login Code"}
					</Text>
				</TouchableOpacity>
				<TouchableOpacity
					onPress={() => {
						setAuthMode(isRegister ? "login" : "register");
						setAuthStep("credentials");
						setAuthCode("");
						setAuthError(null);
						setAuthDebugCode("");
					}}
					disabled={authBusy}
					activeOpacity={0.85}
					style={styles.authSecondaryButton}
				>
					<Text style={styles.authSecondaryButtonText}>
						{isRegister
							? "Already have an account? Sign in"
							: "First time? Create an account"}
					</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			{/* Transparent status bar for immersive video */}
			<StatusBar
				translucent
				backgroundColor="transparent"
				barStyle="light-content"
			/>
			<Modal
				transparent
				visible={isAivaPromptOpen}
				animationType="fade"
				onRequestClose={() => setIsAivaPromptOpen(false)}
			>
				<View style={styles.aivaModalBackdrop}>
					<View style={styles.aivaModalCard}>
						<Text style={styles.aivaModalTitle}>Generate AIVA Video</Text>
						<Text style={styles.aivaModalLabel}>Video title</Text>
						<TextInput
							value={aivaTitle}
							onChangeText={setAivaTitle}
							placeholder="My AIVA video"
							placeholderTextColor="rgba(255,255,255,0.5)"
							style={styles.aivaModalInput}
						/>
						<Text style={styles.aivaModalLabel}>Prompt text</Text>
						<TextInput
							value={aivaPromptText}
							onChangeText={setAivaPromptText}
							placeholder="Describe the scene..."
							placeholderTextColor="rgba(255,255,255,0.5)"
							multiline
							style={styles.aivaModalInput}
						/>
						<Text style={styles.aivaModalLabel}>Prompt image (1 only)</Text>
						<View style={styles.aivaUrlRow}>
							<TextInput
								value={aivaImageUrlInput}
								onChangeText={setAivaImageUrlInput}
								placeholder="https://example.com/image.jpg"
								placeholderTextColor="rgba(255,255,255,0.5)"
								autoCapitalize="none"
								autoCorrect={false}
								style={[styles.aivaModalInput, styles.aivaUrlInput]}
							/>
							<TouchableOpacity
								onPress={addAivaImageUrl}
								activeOpacity={0.9}
								style={styles.aivaAddButton}
							>
								<Text style={styles.aivaAddButtonText}>Add</Text>
							</TouchableOpacity>
						</View>
						<View style={styles.aivaModalRow}>
							<TouchableOpacity
								onPress={handlePickAivaImage}
								activeOpacity={0.9}
								style={styles.aivaPickButton}
							>
								<Text style={styles.aivaPickButtonText}>
									Add Photo
								</Text>
							</TouchableOpacity>
							<Text style={styles.aivaCountText}>
								{aivaImages.length ? "1 selected" : "0 selected"}
							</Text>
						</View>
						{aivaImages.length > 0 && (
							<View style={styles.aivaPreviewRow}>
								<View key={aivaImages[0].id} style={styles.aivaPreviewItem}>
									<Image source={{ uri: aivaImages[0].uri }} style={styles.aivaPreview} />
									<TouchableOpacity
										onPress={() => removeAivaImage(aivaImages[0].id)}
										activeOpacity={0.8}
										style={styles.aivaRemoveButton}
									>
										<Text style={styles.aivaRemoveText}>✕</Text>
									</TouchableOpacity>
								</View>
							</View>
						)}
						<Text style={styles.aivaHintText}>
							Adding a new image replaces the current image.
						</Text>
						<Text style={styles.aivaModalLabel}>Duration</Text>
						<View style={styles.aivaDurationRow}>
							<TouchableOpacity
								onPress={() => setAivaDuration(5)}
								activeOpacity={0.9}
								style={[
									styles.aivaDurationButton,
									aivaDuration === 5 && styles.aivaDurationButtonActive,
								]}
							>
								<Text style={styles.aivaDurationText}>5s</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => setAivaDuration(10)}
								activeOpacity={0.9}
								style={[
									styles.aivaDurationButton,
									aivaDuration === 10 && styles.aivaDurationButtonActive,
								]}
							>
								<Text style={styles.aivaDurationText}>10s</Text>
							</TouchableOpacity>
						</View>
						{aivaError ? (
							<Text style={styles.aivaErrorText}>{aivaError}</Text>
						) : null}
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={() => setIsAivaPromptOpen(false)}
								activeOpacity={0.9}
								style={styles.aivaModalButton}
							>
								<Text style={styles.aivaModalButtonText}>Cancel</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={handleGenerateAiva}
								activeOpacity={0.9}
								disabled={isGeneratingAiva}
								style={[
									styles.aivaModalButton,
									styles.aivaModalButtonPrimary,
									isGeneratingAiva && styles.aivaModalButtonDisabled,
								]}
							>
								<Text style={styles.aivaModalButtonText}>
									{isGeneratingAiva ? "Generating..." : "Generate"}
								</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
			{isAivaWaiting ? (
				<View style={styles.aivaLoadingOverlay} pointerEvents="none">
					<View style={styles.aivaLoadingCard}>
						<Text style={styles.aivaLoadingTitle}>Generating video...</Text>
						<View style={styles.aivaProgressTrack}>
							<View
								style={[
									styles.aivaProgressFill,
									{ width: `${Math.max(5, Math.min(100, aivaProgress))}%` },
								]}
							/>
						</View>
						<Text style={styles.aivaLoadingPercent}>
							{Math.round(Math.max(5, Math.min(100, aivaProgress)))}%
						</Text>
					</View>
				</View>
			) : null}

			<FlatList
				ref={pagerRef}
				data={pages}
				keyExtractor={(item) => item.key}
				horizontal
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				onViewableItemsChanged={onPagerViewableItemsChanged}
				viewabilityConfig={pagerViewabilityConfig}
				renderItem={({ item }) => {
					if (item.key === "profile") {
						return (
							<View style={styles.profilePage}>
								<View style={styles.profileTopRow}>
									<Text style={styles.profileTitle}>Profile</Text>
									<View style={styles.profileTopActions}>
										<TouchableOpacity
											onPress={() => {
												setAivaError(null);
												setIsAivaPromptOpen(true);
											}}
											hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
											style={styles.aivaSettingsButton}
										>
											<Text style={styles.aivaSettingsIcon}>✨</Text>
										</TouchableOpacity>
										<TouchableOpacity
											onPress={handleLogout}
											hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
											style={styles.settingsButton}
										>
											<Text style={styles.settingsIcon}>⎋</Text>
										</TouchableOpacity>
									</View>
								</View>
								<View style={styles.profileHeader}>
									<View style={styles.profileAvatar} />
									<Text style={styles.profileUsername}>@{currentUser}</Text>
									{currentUser === "andrew" ? (
										<TouchableOpacity
											onPress={handleResetUploadCount}
											disabled={isResettingUploads}
											activeOpacity={0.9}
											style={[
												styles.resetUploadsButton,
												isResettingUploads && styles.resetUploadsButtonDisabled,
											]}
										>
											<Text style={styles.resetUploadsButtonText}>
												{isResettingUploads
													? "Resetting..."
													: "Reset Upload Count"}
											</Text>
										</TouchableOpacity>
									) : null}
								</View>
								<View style={styles.profileStats}>
									<View style={styles.profileStat}>
										<Text style={styles.profileStatValue}>
											{userVideos.length}
										</Text>
										<Text style={styles.profileStatLabel}>Videos</Text>
									</View>
									<View style={styles.profileStat}>
										<Text style={styles.profileStatValue}>0</Text>
										<Text style={styles.profileStatLabel}>Followers</Text>
									</View>
									<View style={styles.profileStat}>
										<Text style={styles.profileStatValue}>0</Text>
										<Text style={styles.profileStatLabel}>Following</Text>
									</View>
								</View>
								<View style={styles.profileTabRow}>
									<Text style={styles.profileTabActive}>Videos</Text>
								</View>
									<FlatList
										data={userVideos}
										keyExtractor={(video) => video.id}
										numColumns={3}
										renderItem={({ item: video, index }) => (
											<TouchableOpacity
												onPress={() => handleProfileVideoPress(index)}
												activeOpacity={0.9}
												style={styles.profileVideoTile}
											>
												<Image
													source={{ uri: video.poster }}
													style={styles.profileVideoImage}
												/>
											</TouchableOpacity>
										)}
										contentContainerStyle={styles.profileGrid}
										showsVerticalScrollIndicator={false}
								/>
							</View>
						);
					}

					return (
						<View style={styles.feedPage}>
							<View style={styles.searchBar}>
								{isSearchOpen ? (
									<View style={styles.searchInputRow}>
										<TextInput
											value={searchQuery}
											onChangeText={setSearchQuery}
											placeholder="Search videos"
											placeholderTextColor="rgba(255,255,255,0.6)"
											autoCapitalize="none"
											autoCorrect={false}
											clearButtonMode="while-editing"
											style={styles.searchInput}
										/>
										<TouchableOpacity
											onPress={() => {
												setIsSearchOpen(false);
												setSearchQuery("");
											}}
											hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
											style={styles.searchClose}
										>
											<Text style={styles.searchIcon}>✕</Text>
										</TouchableOpacity>
									</View>
								) : (
									<TouchableOpacity
										onPress={() => setIsSearchOpen(true)}
										hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
										style={styles.searchButton}
									>
										<Text style={styles.searchIcon}>🔍</Text>
									</TouchableOpacity>
								)}
							</View>
							{feedFilter === "user" && (
								<TouchableOpacity
									onPress={() => {
										lastFeedEntryRef.current = "manual";
										setPendingFeedIndex(null);
										setFeedFilter("all");
										setSearchQuery("");
										setIsSearchOpen(false);
										pagerRef.current?.scrollToIndex({
											index: 0,
											animated: true,
										});
										feedListRef.current?.scrollToIndex({
											index: 0,
											animated: false,
										});
										setActiveIndex(0);
									}}
									hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
									style={styles.backButton}
								>
									<Text style={styles.backButtonIcon}>←</Text>
								</TouchableOpacity>
							)}

							{/* Full-screen, paged vertical feed */}
							<FlatList
								ref={feedListRef}
								data={filteredFeed}
								keyExtractor={(post) => post.id}
								renderItem={({ item: post, index }) => (
									<VideoPost
										item={post}
										active={isFeedVisible && index === activeIndex}
										likesCount={post.likesCount}
										onToggleLike={toggleLikeById}
										onOpenComments={openCommentsFor}
										onToggleFollow={toggleFollowByUsername}
										followedUsersRef={followedUsersRef}
										currentUser={currentUser}
									/>
								)}
								pagingEnabled
								showsVerticalScrollIndicator={false}
								onViewableItemsChanged={onViewableItemsChanged}
								viewabilityConfig={viewabilityConfig}
								getItemLayout={(_, index) => ({
									length: H,
									offset: H * index,
									index,
								})}
								windowSize={3}
								initialNumToRender={2}
								removeClippedSubviews
							/>

							{isLoadingFeed && (
								<View style={styles.emptyState} pointerEvents="none">
									<Text style={styles.emptyStateText}>Loading feed...</Text>
								</View>
							)}

							{!isLoadingFeed && feedError && (
								<View style={styles.emptyState} pointerEvents="none">
									<Text style={styles.emptyStateText}>{feedError}</Text>
									<Text style={styles.emptyStateSubText}>
										API: {API_BASE_URL}
									</Text>
								</View>
							)}

							{isSearchOpen &&
								searchQuery.trim().length > 0 &&
								filteredFeed.length === 0 && (
								<View style={styles.emptyState} pointerEvents="none">
									<Text style={styles.emptyStateText}>
										No matches in caption, audio, or captions.
									</Text>
								</View>
							)}
							<CommentsSection
								visible={commentsOpen}
								post={activeCommentsPost}
								onClose={closeComments}
								onAddComment={addCommentToActivePost}
							/>
						</View>
					);
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	authContainer: {
		flex: 1,
		backgroundColor: "#0b0d14",
		paddingHorizontal: 20,
		justifyContent: "center",
	},
	authTitle: {
		color: "white",
		fontSize: 28,
		fontWeight: "800",
		marginBottom: 8,
	},
	authSubtitle: {
		color: "rgba(255,255,255,0.75)",
		fontSize: 14,
		lineHeight: 20,
		marginBottom: 18,
	},
	authInput: {
		backgroundColor: "rgba(255,255,255,0.08)",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		color: "white",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.12)",
		marginBottom: 10,
	},
	authPrimaryButton: {
		marginTop: 4,
		paddingVertical: 12,
		borderRadius: 12,
		backgroundColor: "#2f83ff",
		alignItems: "center",
	},
	authPrimaryButtonText: {
		color: "white",
		fontWeight: "700",
	},
	authSecondaryButton: {
		marginTop: 10,
		paddingVertical: 10,
		alignItems: "center",
	},
	authSecondaryButtonText: {
		color: "rgba(255,255,255,0.8)",
		fontWeight: "600",
		fontSize: 13,
	},
	authError: {
		color: "#ff8f8f",
		marginTop: 2,
		marginBottom: 2,
	},
	authDevCode: {
		color: "rgba(255,255,255,0.7)",
		marginBottom: 6,
		fontSize: 12,
	},
	authButtonDisabled: {
		opacity: 0.6,
	},
	authLoadingText: {
		color: "rgba(255,255,255,0.75)",
		textAlign: "center",
		marginTop: 12,
	},
	container: { flex: 1, backgroundColor: "black" },
	feedPage: { width: W, height: H, backgroundColor: "black" },
	profilePage: { width: W, height: H, backgroundColor: "black" },
	page: { height: H, width: W, backgroundColor: "black" },
	video: { height: H, width: W },

	rightRail: {
		position: "absolute",
		right: 12,
		bottom: 140,
		alignItems: "center",
		gap: 18,
	},
	railButton: {
		alignItems: "center",
	},
	icon: { color: "white", fontSize: 26 },
	iconLiked: { color: "red" },
	count: { color: "white", fontSize: 12, marginTop: 4 },

	bottomMeta: {
		position: "absolute",
		left: 12,
		right: 90,
		bottom: 40,
	},
	usernameRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	username: { color: "white", fontWeight: "800", fontSize: 16 },
	caption: { color: "white", marginTop: 6 },
	audio: { color: "rgba(255,255,255,0.8)", marginTop: 4 },
	followButton: {
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 999,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(255,255,255,0.85)",
	},
	followButtonUnfollow: {
		backgroundColor: "rgba(0,0,0,0)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.8)",
	},
	followButtonText: {
		color: "black",
		fontSize: 12,
		fontWeight: "700",
		letterSpacing: 0.2,
	},
	followButtonTextUnfollow: {
		color: "white",
	},
	followButtonDisabled: {
		backgroundColor: "rgba(255,255,255,0.15)",
		borderWidth: 0,
	},
	followButtonTextDisabled: {
		color: "rgba(255,255,255,0.7)",
	},

	playPauseOverlay: {
		position: "absolute",
		alignSelf: "center",
		top: H / 2 - 34,
		width: 68,
		height: 68,
		borderRadius: 34,
		backgroundColor: "rgba(0,0,0,0.35)",
		alignItems: "center",
		justifyContent: "center",
	},
	playPauseIcon: {
		color: "rgba(255,255,255,0.85)",
		fontSize: 32,
		fontWeight: "800",
	},

	likePop: {
		position: "absolute",
		alignSelf: "center",
		top: H / 2 - 80,
	},
	likePopText: {
		color: "red",
		fontSize: 72,
	},

	searchBar: {
		position: "absolute",
		top: 48,
		left: 12,
		right: 12,
		zIndex: 20,
		alignItems: "flex-end"
	},
	backButton: {
		position: "absolute",
		top: 48,
		left: 12,
		zIndex: 21,
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(0,0,0,0.35)",
	},
	backButtonIcon: {
		color: "white",
		fontSize: 20,
		fontWeight: "700",
	},
	searchInputRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	searchInput: {
		flex: 1,
		height: 40,
		borderRadius: 20,
		paddingHorizontal: 16,
		color: "white",
		backgroundColor: "rgba(0,0,0,0.45)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.2)",
	},
	searchButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",

		// ✅ remove dark circle/background + border
		backgroundColor: "transparent",
		borderWidth: 0,
	},
	aivaModalBackdrop: {
		flex: 1,
		backgroundColor: "rgba(0,0,0,0.6)",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 20,
	},
	aivaModalCard: {
		width: "100%",
		maxWidth: 420,
		backgroundColor: "#141621",
		borderRadius: 18,
		padding: 18,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.08)",
	},
	aivaModalTitle: {
		color: "white",
		fontSize: 18,
		fontWeight: "600",
		marginBottom: 12,
	},
	aivaModalLabel: {
		color: "rgba(255,255,255,0.7)",
		fontSize: 12,
		letterSpacing: 0.5,
		textTransform: "uppercase",
		marginBottom: 6,
	},
	aivaModalInput: {
		backgroundColor: "rgba(255,255,255,0.06)",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 10,
		color: "white",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.08)",
		marginBottom: 12,
	},
	aivaUrlRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	aivaUrlInput: {
		flex: 1,
		marginBottom: 0,
	},
	aivaAddButton: {
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 10,
		backgroundColor: "rgba(47,131,255,0.25)",
		borderWidth: 1,
		borderColor: "rgba(47,131,255,0.45)",
	},
	aivaAddButtonText: {
		color: "white",
		fontWeight: "600",
		fontSize: 12,
	},
	aivaModalRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		marginBottom: 12,
	},
	aivaPickButton: {
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: 12,
		backgroundColor: "rgba(255,255,255,0.08)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.15)",
	},
	aivaPickButtonText: {
		color: "white",
		fontWeight: "600",
		fontSize: 12,
		letterSpacing: 0.3,
	},
	aivaCountText: {
		color: "rgba(255,255,255,0.7)",
		fontSize: 12,
	},
	aivaPreviewRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		marginBottom: 10,
	},
	aivaPreviewItem: {
		position: "relative",
	},
	aivaPreview: {
		width: 64,
		height: 64,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.12)",
	},
	aivaRemoveButton: {
		position: "absolute",
		top: -6,
		right: -6,
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: "rgba(0,0,0,0.7)",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.2)",
	},
	aivaRemoveText: {
		color: "white",
		fontSize: 12,
	},
	aivaHintText: {
		color: "rgba(255,255,255,0.5)",
		fontSize: 12,
		marginBottom: 12,
	},
	aivaDurationRow: {
		flexDirection: "row",
		gap: 10,
		marginBottom: 12,
	},
	aivaDurationButton: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 10,
		backgroundColor: "rgba(255,255,255,0.08)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.15)",
	},
	aivaDurationButtonActive: {
		backgroundColor: "rgba(47,131,255,0.35)",
		borderColor: "rgba(47,131,255,0.55)",
	},
	aivaDurationText: {
		color: "white",
		fontWeight: "600",
		fontSize: 12,
	},
	aivaErrorText: {
		color: "#ff8f8f",
		marginBottom: 10,
	},
	aivaModalActions: {
		flexDirection: "row",
		justifyContent: "flex-end",
		gap: 10,
	},
	aivaModalButton: {
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: 10,
		backgroundColor: "rgba(255,255,255,0.08)",
	},
	aivaModalButtonPrimary: {
		backgroundColor: "#2f83ff",
	},
	aivaModalButtonDisabled: {
		opacity: 0.6,
	},
	aivaModalButtonText: {
		color: "white",
		fontWeight: "600",
		fontSize: 12,
	},
	aivaLoadingOverlay: {
		position: "absolute",
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
		zIndex: 40,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(0,0,0,0.38)",
	},
	aivaLoadingCard: {
		width: "82%",
		maxWidth: 360,
		backgroundColor: "rgba(20,22,33,0.95)",
		borderRadius: 14,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.1)",
	},
	aivaLoadingTitle: {
		color: "white",
		fontSize: 14,
		fontWeight: "600",
		marginBottom: 8,
	},
	aivaProgressTrack: {
		height: 9,
		borderRadius: 999,
		backgroundColor: "rgba(255,255,255,0.14)",
		overflow: "hidden",
	},
	aivaProgressFill: {
		height: "100%",
		borderRadius: 999,
		backgroundColor: "#2f83ff",
	},
	aivaLoadingPercent: {
		color: "rgba(255,255,255,0.86)",
		fontSize: 12,
		marginTop: 8,
		textAlign: "right",
	},

	searchClose: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(0,0,0,0.45)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.2)",
	},
	searchIcon: {
		color: "white",
		fontSize: 16,
	},
	emptyState: {
		position: "absolute",
		top: H / 2 - 20,
		left: 24,
		right: 24,
		alignItems: "center",
	},
	emptyStateText: {
		color: "rgba(255,255,255,0.8)",
		textAlign: "center",
	},
	emptyStateSubText: {
		color: "rgba(255,255,255,0.55)",
		textAlign: "center",
		marginTop: 6,
		fontSize: 12,
	},

	profileTopRow: {
		marginTop: 48,
		paddingHorizontal: 16,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	profileTopActions: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	profileTitle: {
		color: "white",
		fontSize: 18,
		fontWeight: "700",
	},
	settingsButton: {
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(255,255,255,0.08)",
	},
	settingsIcon: {
		color: "white",
		fontSize: 18,
	},
	aivaSettingsButton: {
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(47,131,255,0.2)",
		borderWidth: 1,
		borderColor: "rgba(47,131,255,0.45)",
	},
	aivaSettingsIcon: {
		color: "white",
		fontSize: 16,
	},
	profileHeader: {
		marginTop: 24,
		alignItems: "center",
	},
	profileAvatar: {
		width: 88,
		height: 88,
		borderRadius: 44,
		backgroundColor: "rgba(255,255,255,0.2)",
	},
	profileUsername: {
		color: "white",
		fontWeight: "700",
		fontSize: 16,
		marginTop: 12,
	},
	resetUploadsButton: {
		marginTop: 12,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 999,
		backgroundColor: "rgba(255,90,90,0.2)",
		borderWidth: 1,
		borderColor: "rgba(255,90,90,0.5)",
	},
	resetUploadsButtonDisabled: {
		opacity: 0.55,
	},
	resetUploadsButtonText: {
		color: "white",
		fontSize: 12,
		fontWeight: "700",
	},
	profileStats: {
		marginTop: 20,
		flexDirection: "row",
		justifyContent: "center",
		gap: 24,
	},
	profileStat: {
		alignItems: "center",
	},
	profileStatValue: {
		color: "white",
		fontSize: 16,
		fontWeight: "700",
	},
	profileStatLabel: {
		color: "rgba(255,255,255,0.6)",
		fontSize: 12,
		marginTop: 4,
	},
	profileTabRow: {
		marginTop: 24,
		alignItems: "center",
	},
	profileTabActive: {
		color: "white",
		fontWeight: "700",
		fontSize: 14,
		paddingBottom: 8,
		borderBottomWidth: 2,
		borderBottomColor: "white",
	},
	profileGrid: {
		paddingHorizontal: 2,
		paddingTop: 12,
		paddingBottom: 24,
	},
	profileVideoTile: {
		aspectRatio: 9 / 16,
		width: (W - 12) / 3,
		margin: 2,
		backgroundColor: "rgba(255,255,255,0.08)",
		overflow: "hidden",
	},
	profileVideoImage: {
		width: "100%",
		height: "100%",
		resizeMode: "cover",
	},
});
