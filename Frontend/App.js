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
	Alert,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
// Ads temporarily disabled until AdMob app approval.
// To re-enable, uncomment the import below and the "ADS (disabled)" blocks in this file.
// import mobileAds, {
// 	InterstitialAd as GoogleInterstitialAd,
// 	AdEventType,
// 	TestIds,
// } from "react-native-google-mobile-ads";
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

function resolveAssetUrl(rawValue, baseUrl = API_BASE_URL) {
	const value = String(rawValue || "").trim();
	if (!value) return "";
	if (/^(https?:|file:|data:)/i.test(value)) return value;
	if (value.startsWith("/")) return `${String(baseUrl || "").replace(/\/+$/, "")}${value}`;
	return value;
}

function withCacheBust(rawValue, nonce) {
	const value = String(rawValue || "").trim();
	if (!value || !nonce) return value;
	const sep = value.includes("?") ? "&" : "?";
	return `${value}${sep}v=${encodeURIComponent(String(nonce))}`;
}

const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
const AIVA_VIDEO_LIMIT = 3;
const AUTH_SESSION_STORAGE_KEY = "aiva_auth_session_v1";
const MAX_AIVA_IMAGES = 12;
const AIVA_SECONDS_PER_IMAGE = 5;
// ADS (disabled):
// const AIVA_ADS_PER_REWARDED_VIDEO = 10;
// const AD_TRIGGER_SCORE = 10;
// const ADMOB_APP_ID = "ca-app-pub-5075530037572927~7340043041";
// const ADMOB_INTERSTITIAL_UNIT_ID = "ca-app-pub-5075530037572927/5145629126";
// const USE_TEST_ADS =
// 	String(process.env.EXPO_PUBLIC_USE_TEST_ADS || "")
// 		.trim()
// 		.toLowerCase() === "true";

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
			createdAt: String(raw?.createdAt ?? raw?.created_at ?? "").trim(),
			poster: String(raw?.poster ?? raw?.posterUrl ?? "").trim(),
			likes: Number(raw?.likes) || 0,
			isLiked: Boolean(raw?.isLiked),
			hasSeen: Boolean(raw?.hasSeen),
			userViewCount: Number(raw?.userViewCount ?? 0) || 0,
			comments,
			commentsCount,
		});
	}

	return normalized;
}

function getCreatedAtTimestamp(value) {
	const parsed = Date.parse(String(value || ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

function sortByCreatedAtDesc(items) {
	return [...items]
		.map((post, index) => ({ post, index }))
		.sort((a, b) => {
			const at = getCreatedAtTimestamp(a.post?.createdAt);
			const bt = getCreatedAtTimestamp(b.post?.createdAt);
			if (bt !== at) return bt - at;
			return a.index - b.index;
		})
		.map((row) => row.post);
}

function tokenizeText(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter((token) => token.length >= 3);
}

function getPostTokenSet(post) {
	const commentsText = Array.isArray(post?.comments)
		? post.comments.map((c) => c?.text || "").join(" ")
		: "";
	return new Set(
		tokenizeText(
			`${post?.username || ""} ${post?.caption || ""} ${post?.audio || ""} ${commentsText}`
		)
	);
}

function buildProfileTokenWeights({
	items,
	followedUsers,
	userCommentCountsById,
	userViewCountsById,
}) {
	const prepared = items.map((post, index) => ({
		post,
		index,
		tokens: getPostTokenSet(post),
	}));
	const tokenWeights = {};

	for (const item of prepared) {
		const { post, tokens } = item;
		const liked = !!post.isLiked;
		const subscribed = followedUsers.has(post.username);
		const commentsByUser = Number(userCommentCountsById[post.id] || 0);
		const viewsByUser = Number(userViewCountsById[post.id] || 0);
		let interactionWeight = 0;
		if (subscribed) interactionWeight += 4.0;
		if (liked) interactionWeight += 3.5;
		if (commentsByUser > 0) interactionWeight += 1.2 * commentsByUser;
		if (viewsByUser > 0) interactionWeight += Math.min(2.2, Math.log1p(viewsByUser));
		if (interactionWeight <= 0) continue;
		for (const token of tokens) {
			tokenWeights[token] = (tokenWeights[token] || 0) + interactionWeight;
		}
	}

	const tokenMass = Object.values(tokenWeights).reduce((sum, value) => sum + value, 0);
	return { prepared, tokenWeights, tokenMass };
}

function computeKeywordScore({
	post,
	index,
	postTokens,
	followedUsers,
	userCommentCountsById,
	userViewCountsById,
	tokenWeights,
	tokenMass,
}) {
	const W_SUBSCRIBED = 120;
	const W_LIKED = 95;
	const W_COMMENTED = 35;
	const W_VIEWS = 22;
	const W_SIMILARITY = 80;
	const W_RECENCY = 8;
	const W_UNSEEN = 220;
	const commentsByUser = Number(userCommentCountsById[post.id] || 0);
	const viewsByUser = Number(userViewCountsById[post.id] || 0);
	let similarity = 0;

	if (tokenMass > 0 && postTokens.size > 0) {
		let overlap = 0;
		for (const token of postTokens) overlap += tokenWeights[token] || 0;
		similarity = overlap / tokenMass;
	}

	let score = 0;
	if (followedUsers.has(post.username)) score += W_SUBSCRIBED;
	if (post.isLiked) score += W_LIKED;
	if (!post.hasSeen) score += W_UNSEEN;
	score += Math.min(3, commentsByUser) * W_COMMENTED;
	score += Math.min(2.5, Math.log1p(viewsByUser)) * W_VIEWS;
	score += similarity * W_SIMILARITY;
	score += Math.max(0, 1 - index / 20) * W_RECENCY;

	return { score, similarity };
}

function generateStage1Candidates({
	items,
	followedUsers,
	userCommentCountsById,
	userViewCountsById,
	maxCandidates = 120,
}) {
	const { prepared, tokenWeights, tokenMass } = buildProfileTokenWeights({
		items,
		followedUsers,
		userCommentCountsById,
		userViewCountsById,
	});

	const scored = prepared.map(({ post, index, tokens }) => {
		const { score, similarity } = computeKeywordScore({
			post,
			index,
			postTokens: tokens,
			followedUsers,
			userCommentCountsById,
			userViewCountsById,
			tokenWeights,
			tokenMass,
		});

		return {
			post,
			index,
			tokens,
			keywordScore: score,
			similarity,
		};
	});

	scored.sort((a, b) => {
		if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
		return a.index - b.index;
	});

	return scored.slice(0, Math.min(maxCandidates, scored.length));
}

function sigmoid(x) {
	return 1 / (1 + Math.exp(-x));
}

function logisticPredict(weights, features) {
	let z = 0;
	for (let i = 0; i < weights.length; i += 1) {
		z += weights[i] * features[i];
	}
	return sigmoid(Math.max(-20, Math.min(20, z)));
}

function trainLogisticRegression(samples, featureLength, opts = {}) {
	if (!samples.length || !featureLength) {
		return { weights: new Array(featureLength).fill(0) };
	}
	const learningRate = opts.learningRate ?? 0.1;
	const epochs = opts.epochs ?? 160;
	const l2 = opts.l2 ?? 0.002;
	const weights = new Array(featureLength).fill(0);

	for (let epoch = 0; epoch < epochs; epoch += 1) {
		const gradient = new Array(featureLength).fill(0);
		for (const sample of samples) {
			const p = logisticPredict(weights, sample.features);
			const error = p - sample.label;
			for (let i = 0; i < featureLength; i += 1) {
				gradient[i] += error * sample.features[i];
			}
		}
		for (let i = 0; i < featureLength; i += 1) {
			const reg = i === 0 ? 0 : l2 * weights[i];
			weights[i] -= learningRate * (gradient[i] / samples.length + reg);
		}
	}

	return { weights };
}

function buildModelFeatures({
	keywordScore,
	similarity,
	post,
	stage1RankIndex,
	followedUsers,
	userCommentCountsById,
	userViewCountsById,
	includeKeywordFeature,
}) {
	const viewsByUser = Number(userViewCountsById[post.id] || 0);
	const commentsByUser = Number(userCommentCountsById[post.id] || 0);
	const followed = followedUsers.has(post.username) ? 1 : 0;
	const liked = post.isLiked ? 1 : 0;
	const unseen = post.hasSeen ? 0 : 1;
	const rankNorm = 1 - Math.min(1, stage1RankIndex / 40);
	const logKeyword = Math.log1p(Math.max(0, keywordScore)) / 8;

	const features = [
		1,
		unseen,
		followed,
		liked,
		Math.min(1, Math.log1p(viewsByUser) / 3),
		Math.min(1, Math.log1p(commentsByUser) / 3),
		Math.min(1, Math.max(0, similarity)),
		rankNorm,
	];

	if (includeKeywordFeature) {
		features.push(Math.min(1.5, logKeyword));
	}
	return features;
}

function splitTrainTestRows(rows) {
	const train = [];
	const test = [];
	for (const row of rows) {
		const bucket =
			String(row.postId || "")
				.split("")
				.reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10;
		if (bucket <= 7) train.push(row);
		else test.push(row);
	}
	return { train, test };
}

function computeAuc(rows, scoreById) {
	const positives = rows.filter((r) => r.label === 1);
	const negatives = rows.filter((r) => r.label === 0);
	if (!positives.length || !negatives.length) return null;
	let wins = 0;
	let pairs = 0;
	for (const pos of positives) {
		for (const neg of negatives) {
			const ps = scoreById[pos.postId] ?? 0;
			const ns = scoreById[neg.postId] ?? 0;
			if (ps > ns) wins += 1;
			else if (ps === ns) wins += 0.5;
			pairs += 1;
		}
	}
	return pairs > 0 ? wins / pairs : null;
}

function likeRateAtK(rows, orderedIds, k = 5) {
	if (!rows.length || !orderedIds.length) return null;
	const byId = new Map(rows.map((r) => [r.postId, r.label]));
	const top = orderedIds.slice(0, Math.max(1, k)).filter((id) => byId.has(id));
	if (!top.length) return null;
	const likes = top.reduce((sum, id) => sum + (byId.get(id) ? 1 : 0), 0);
	return likes / top.length;
}

function evaluateRecommendationModels({ rows, stage1ById, learnedScoresById, hybridScoresById }) {
	if (rows.length < 4) return null;
	const keywordScoresById = {};
	for (const row of rows) {
		keywordScoresById[row.postId] = stage1ById[row.postId]?.keywordScore ?? 0;
	}
	const orderedBy = (scores) =>
		Object.keys(scores).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
	const keywordOrder = orderedBy(keywordScoresById);
	const learnedOrder = orderedBy(learnedScoresById);
	const hybridOrder = orderedBy(hybridScoresById);
	const k = Math.min(5, rows.length);
	const keywordLikeRate = likeRateAtK(rows, keywordOrder, k);
	const learnedLikeRate = likeRateAtK(rows, learnedOrder, k);
	const hybridLikeRate = likeRateAtK(rows, hybridOrder, k);
	const keywordAuc = computeAuc(rows, keywordScoresById);
	const learnedAuc = computeAuc(rows, learnedScoresById);
	const hybridAuc = computeAuc(rows, hybridScoresById);

	const improvementPct =
		keywordLikeRate != null && hybridLikeRate != null && keywordLikeRate > 0
			? ((hybridLikeRate - keywordLikeRate) / keywordLikeRate) * 100
			: null;

	return {
		k,
		keywordLikeRate,
		learnedLikeRate,
		hybridLikeRate,
		keywordAuc,
		learnedAuc,
		hybridAuc,
		improvementPct,
	};
}

function buildTrainingRows(stage1Candidates, userViewCountsById) {
	return stage1Candidates
		.filter((entry) => {
			const viewed = Number(userViewCountsById[entry.post.id] || 0) > 0;
			return viewed || entry.post.isLiked;
		})
		.map((entry, stage1RankIndex) => ({
			postId: entry.post.id,
			label: entry.post.isLiked ? 1 : 0,
			stage1RankIndex,
			entry,
		}));
}

function FollowButton({
	username,
	currentUser,
	followedUsersRef,
	onToggleFollow,
}) {
	const isSelf = username === currentUser;
	const isFollowed = followedUsersRef.current.has(username);

	const onPress = useCallback(() => {
		if (isSelf) return;
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
	onOpenUserProfile,
	onDeleteVideo,
	onDeleteChannel,
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
	const onPressDeleteVideo = useCallback(() => {
		Alert.alert(
			"Delete video?",
			"This action cannot be undone.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () => onDeleteVideo?.(item.id),
				},
			]
		);
	}, [item.id, onDeleteVideo]);
	const isAdmin = currentUser === "andrewr";
	const isOwner = currentUser === item.username;
	const canDeleteVideo = isOwner || isAdmin;
	const canDeleteChannel = isAdmin && item.username !== "andrewr";

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
				{/* <TouchableOpacity
					activeOpacity={0.85}
					onPress={() => console.log("share")}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					<Text style={styles.icon}>↗</Text>
					<Text style={styles.count}>Share</Text>
				</TouchableOpacity> */}
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
					<TouchableOpacity
						onPress={() => onOpenUserProfile?.(item.username)}
						activeOpacity={0.85}
						style={styles.usernameButton}
					>
						<Text style={styles.username}>@{item.username}</Text>
					</TouchableOpacity>
					<FollowButton
						username={item.username}
						currentUser={currentUser}
						followedUsersRef={followedUsersRef}
						onToggleFollow={onToggleFollow}
					/>
				</View>
				<Text style={styles.caption}>{item.caption}</Text>
				<Text style={styles.audio}>♫ {item.audio}</Text>
				{canDeleteVideo ? (
					<TouchableOpacity
						onPress={onPressDeleteVideo}
						activeOpacity={0.9}
						style={styles.deleteVideoButton}
					>
						<Text style={styles.deleteVideoButtonText}>Delete Video</Text>
					</TouchableOpacity>
				) : null}
				{canDeleteChannel ? (
					<TouchableOpacity
						onPress={() => onDeleteChannel?.(item.username)}
						activeOpacity={0.9}
						style={styles.deleteChannelButton}
					>
						<Text style={styles.deleteChannelButtonText}>Delete Channel</Text>
					</TouchableOpacity>
				) : null}
			</View>
		</View>
	);
}

function VideoPost(props) {
	return <NativeVideoPost {...props} />;
}

// ADS (disabled):
// function AdFallbackModal({ visible, onClose, score }) {
// 	return (
// 		<Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
// 			<View style={styles.adBackdrop}>
// 				<View style={styles.adCard}>
// 					<Text style={styles.adBadge}>Sponsored</Text>
// 					<Text style={styles.adTitle}>Ad Break</Text>
// 					<Text style={styles.adText}>
// 						Ad fallback shown because a real interstitial was not loaded yet.
// 					</Text>
// 					<Text style={styles.adMeta}>App ID: {ADMOB_APP_ID}</Text>
// 					<Text style={styles.adMeta}>Unit ID: {ADMOB_INTERSTITIAL_UNIT_ID}</Text>
// 					<Text style={styles.adMeta}>
// 						Trigger score reset. Current score: {score}/{AD_TRIGGER_SCORE}
// 					</Text>
// 					<TouchableOpacity
// 						onPress={onClose}
// 						activeOpacity={0.9}
// 						style={styles.adCloseButton}
// 					>
// 						<Text style={styles.adCloseButtonText}>Continue</Text>
// 					</TouchableOpacity>
// 				</View>
// 			</View>
// 		</Modal>
// 	);
// }

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
	const [profilePictureRefreshNonce, setProfilePictureRefreshNonce] = useState(0);
	const [profilePictureLocalPreview, setProfilePictureLocalPreview] = useState("");
	const currentUserProfilePicture = resolveAssetUrl(authUser?.profilePicture || "");
	const displayedProfilePicture = profilePictureLocalPreview
		? profilePictureLocalPreview
		: withCacheBust(currentUserProfilePicture, profilePictureRefreshNonce);
	// Active index controls which item should auto-play.
	const [activeIndex, setActiveIndex] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [feedFilter, setFeedFilter] = useState("all");
	const [selectedProfileUsername, setSelectedProfileUsername] = useState("");
	const [isFeedVisible, setIsFeedVisible] = useState(true);
	const [isLoadingFeed, setIsLoadingFeed] = useState(true);
	const [feedError, setFeedError] = useState(null);
	const [maxIndex, setMaxIndex] = useState(0);
	const pagerRef = useRef(null);
	const feedListRef = useRef(null);
	const lastFeedEntryRef = useRef("manual");
	const [pendingFeedIndex, setPendingFeedIndex] = useState(null);
	const [pendingFeedPostId, setPendingFeedPostId] = useState(null);
	const [isGeneratingAiva, setIsGeneratingAiva] = useState(false);
	const [isAivaPromptOpen, setIsAivaPromptOpen] = useState(false);
	const [aivaTitle, setAivaTitle] = useState("");
	const [aivaScriptText, setAivaScriptText] = useState("");
	const [aivaImageUrlInput, setAivaImageUrlInput] = useState("");
	const [aivaImages, setAivaImages] = useState([]);
	const [aivaError, setAivaError] = useState(null);
	const [isAivaWaiting, setIsAivaWaiting] = useState(false);
	const [aivaProgress, setAivaProgress] = useState(0);
	const [aivaVideoCount, setAivaVideoCount] = useState(0);
	const [aivaVideoLimit, setAivaVideoLimit] = useState(AIVA_VIDEO_LIMIT);
	const [isResettingUploads, setIsResettingUploads] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsBusy, setSettingsBusy] = useState(false);
	const [settingsError, setSettingsError] = useState(null);
	const [settingsInfo, setSettingsInfo] = useState("");
	const [settingsNewPhone, setSettingsNewPhone] = useState("");
	const [settingsPhoneCode, setSettingsPhoneCode] = useState("");
	const [settingsNewPassword, setSettingsNewPassword] = useState("");
	const [settingsPasswordCode, setSettingsPasswordCode] = useState("");
	const [isFollowingListOpen, setIsFollowingListOpen] = useState(false);
	const [isDeletingVideo, setIsDeletingVideo] = useState(false);
	const [isDeletingChannel, setIsDeletingChannel] = useState(false);
	const [followVersion, setFollowVersion] = useState(0);
	const [userCommentCountsById, setUserCommentCountsById] = useState({});
	const [userViewCountsById, setUserViewCountsById] = useState({});
	// ADS (disabled):
	// const [adScoreCount, setAdScoreCount] = useState(0);
	// const [isAdOpen, setIsAdOpen] = useState(false);
	// const adSeenIdsRef = useRef(new Set());
	// const interstitialRef = useRef(null);
	// const interstitialSubscriptionsRef = useRef([]);
	// const isInterstitialLoadedRef = useRef(false);
	// const isInterstitialRetryingRef = useRef(false);
	const currentVisiblePostIdRef = useRef(null);
	const pendingViewPostIdsRef = useRef(new Set());
	const lastViewedPostIdRef = useRef(null);
	const shouldScrollToTopRef = useRef(false);
	const lastRecommendationSignatureRef = useRef("");
	const aivaPollRef = useRef(null);
	const aivaProgressTimerRef = useRef(null);
	// ADS (disabled):
	// const rewardAdPendingRef = useRef(false);
	// const rewardAdCompletionHandlerRef = useRef(null);
	const aivaVideosLeft = Math.max(
		0,
		Math.max(0, Number(aivaVideoLimit) || 0) - Math.max(0, Number(aivaVideoCount) || 0)
	);

	// Local feed state to store per-item likes and comments.
	const [feed, setFeed] = useState([]);

	useEffect(() => {
		setSelectedProfileUsername(currentUser);
	}, [currentUser]);

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

	// ADS (disabled):
	// const completeRewardAdView = useCallback(async () => { ... }, []);
	// useEffect(() => {
	// 	rewardAdCompletionHandlerRef.current = completeRewardAdView;
	// }, [completeRewardAdView]);
	// const prepareInterstitial = useCallback(() => { ... }, []);
	// const showInterstitialAd = useCallback(() => { ... }, [prepareInterstitial]);
	// const handleWatchRewardAd = useCallback(() => { ... }, [prepareInterstitial]);

	const persistAuthSession = useCallback(async (token, user) => {
		const payload = { token, user };
		await AsyncStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(payload));
		setAuthToken(token);
		setAuthUser(user);
	}, []);

	const clearAuthSession = useCallback(async () => {
		setAuthToken(null);
		setAuthUser(null);
		setAivaVideoCount(0);
		setAivaVideoLimit(AIVA_VIDEO_LIMIT);
		followedUsersRef.current = new Set();
		setFollowVersion((v) => v + 1);
		setAuthStep("credentials");
		setAuthError(null);
		setAuthDebugCode("");
		await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
	}, []);

	const updateAuthUser = useCallback(
		async (nextUser) => {
			if (!authToken || !nextUser) {
				setAuthUser(nextUser || null);
				return;
			}
			await AsyncStorage.setItem(
				AUTH_SESSION_STORAGE_KEY,
				JSON.stringify({ token: authToken, user: nextUser })
			);
			setAuthUser(nextUser);
		},
		[authToken]
	);

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
			isLiked: !!p.isLiked,
			likesCount: Number(p.likesCount ?? p.likes ?? 0),
			hasSeen: !!p.hasSeen,
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
			const nextViewCounts = {};
			for (const item of normalized) {
				const count = Number(item.userViewCount || 0);
				if (count > 0) nextViewCounts[item.id] = count;
			}
			setUserViewCountsById(nextViewCounts);
		} catch (error) {
			setFeed([]);
			setFeedError(error?.message ?? "Failed to load feed.");
		} finally {
			setIsLoadingFeed(false);
		}
	}, [apiFetch, currentUserId, hydrateFeed]);

	const loadFollowing = useCallback(async () => {
		try {
			const response = await apiFetch("/following");
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Following request failed (${response.status})`);
			}
			const usernames = Array.isArray(body?.usernames)
				? body.usernames
						.map((name) => String(name || "").trim())
						.filter(Boolean)
				: [];
			followedUsersRef.current = new Set(usernames);
			setFollowVersion((v) => v + 1);
		} catch (error) {
			console.warn("Failed to load following:", error);
			followedUsersRef.current = new Set();
			setFollowVersion((v) => v + 1);
		}
	}, [apiFetch]);

	const loadAivaStatus = useCallback(async () => {
		if (!currentUserId) return;
		try {
			const response = await apiFetch(
				`/aiva/status?userId=${encodeURIComponent(currentUserId)}`
			);
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `AIVA status failed (${response.status})`);
			}
			const nextCount = Number(body?.count ?? 0);
			const nextLimit = Number(body?.limit ?? AIVA_VIDEO_LIMIT);
			setAivaVideoCount(Number.isFinite(nextCount) ? nextCount : 0);
			setAivaVideoLimit(Number.isFinite(nextLimit) ? nextLimit : AIVA_VIDEO_LIMIT);
		} catch (error) {
			console.warn("Failed to load AIVA status:", error);
		}
	}, [apiFetch, currentUserId]);

	useEffect(() => {
		if (!authUser || !authToken) return;
		loadFeed();
		loadFollowing();
		loadAivaStatus();
	}, [authToken, authUser, loadFeed, loadFollowing, loadAivaStatus]);

	useEffect(() => {
		return () => {
			// ADS (disabled):
			// for (const unsubscribe of interstitialSubscriptionsRef.current) {
			// 	try {
			// 		unsubscribe?.();
			// 	} catch {
			// 		// ignore listener cleanup issues
			// 	}
			// }
			// interstitialSubscriptionsRef.current = [];
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

	// ADS (disabled):
	// useEffect(() => {
	// 	mobileAds()
	// 		.initialize()
	// 		.then(() => prepareInterstitial())
	// 		.catch((error) => {
	// 			console.warn("AdMob initialization failed:", error);
	// 		});
	// }, [prepareInterstitial]);

	const addAivaImageUrl = useCallback(() => {
		const trimmed = aivaImageUrlInput.trim();
		if (!trimmed) return;
		if (!/^https?:\/\//i.test(trimmed)) {
			setAivaError("Image URL must start with http:// or https://");
			return;
		}
		setAivaImages((prev) => {
			if (prev.length >= MAX_AIVA_IMAGES) {
				setAivaError(`You can add up to ${MAX_AIVA_IMAGES} images.`);
				return prev;
			}
			return [
				...prev,
				{ id: `${Date.now()}-${Math.random()}`, type: "url", uri: trimmed },
			];
		});
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
				const nextCount = Number(data?.count ?? 0);
				const nextLimit = Number(data?.limit ?? AIVA_VIDEO_LIMIT);
				if (Number.isFinite(nextCount)) {
					setAivaVideoCount(nextCount);
				}
				if (Number.isFinite(nextLimit)) {
					setAivaVideoLimit(nextLimit);
				}
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

		let result;
		try {
			result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				allowsEditing: false,
				allowsMultipleSelection: true,
				selectionLimit: MAX_AIVA_IMAGES,
				quality: 0.9,
			});
		} catch (error) {
			setAivaError(error?.message || "Failed to open photo library.");
			return;
		}

		if (result.canceled) return;
		const pickedAssets = Array.isArray(result.assets)
			? result.assets.filter((asset) => asset?.uri)
			: [];
		if (!pickedAssets.length) return;

		setAivaImages((prev) => {
			if (prev.length >= MAX_AIVA_IMAGES) {
				setAivaError(`You can add up to ${MAX_AIVA_IMAGES} images.`);
				return prev;
			}
			const remaining = MAX_AIVA_IMAGES - prev.length;
			const next = pickedAssets.slice(0, remaining).map((asset) => ({
				id: `${Date.now()}-${Math.random()}`,
				type: "local",
				uri: asset.uri,
				name: asset.fileName,
				mimeType: asset.mimeType,
			}));
			if (pickedAssets.length > remaining) {
				setAivaError(`Only the first ${remaining} image(s) were added (max ${MAX_AIVA_IMAGES}).`);
			}
			return [...prev, ...next];
		});
	}, []);

	const prepareAivaImageUrls = useCallback(async () => {
		const uploadedById = {};
		for (const img of aivaImages) {
			if (img.type !== "local") continue;
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
			if (!data?.imageUrl) {
				throw new Error("Image upload did not return a usable URL.");
			}
			uploadedById[img.id] = data.imageUrl;
		}

		return aivaImages
			.map((img) => (img.type === "url" ? img.uri : uploadedById[img.id]))
			.filter(Boolean);
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
			const trimmedScript = aivaScriptText.trim();
			if (!trimmedScript) {
				throw new Error("Script is required.");
			}

			if (!aivaImages.length) {
				throw new Error("Provide at least one image.");
			}
			if (aivaImages.length > MAX_AIVA_IMAGES) {
				throw new Error(`Use at most ${MAX_AIVA_IMAGES} images.`);
			}

			const finalImageUrls = await prepareAivaImageUrls();
			if (!finalImageUrls.length) {
				throw new Error("Could not prepare images for generation.");
			}

			setIsAivaWaiting(true);
			const response = await apiFetch("/aiva/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userId: currentUserId,
					title: trimmedTitle,
					promptText: trimmedScript,
					imageUrls: finalImageUrls,
				}),
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.error || `AIVA request failed (${response.status})`);
			}
			startAivaPolling();
			setIsAivaPromptOpen(false);
		} catch (error) {
			setIsAivaWaiting(false);
			setAivaProgress(0);
			setAivaTitle("");
			setAivaScriptText("");
			setAivaImageUrlInput("");
			setAivaImages([]);
			setAivaError(error?.message ?? "AIVA generation failed.");
			console.warn("AIVA generation failed:", error);
		} finally {
			setIsGeneratingAiva(false);
		}
	}, [
		aivaImages,
		aivaScriptText,
		aivaTitle,
		apiFetch,
		currentUserId,
		isGeneratingAiva,
		prepareAivaImageUrls,
	]);

	const handleResetUploadCount = useCallback(async () => {
		if (isResettingUploads || currentUser.toLowerCase() !== "andrewr") return;
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
			setAivaVideoCount(0);
			await loadFeed();
		} catch (error) {
			setAivaError(error?.message ?? "Failed to reset upload count.");
		} finally {
			setIsResettingUploads(false);
		}
	}, [apiFetch, currentUser, currentUserId, isResettingUploads, loadFeed]);

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

	const handlePickProfilePhoto = useCallback(async () => {
		if (settingsBusy) return;
		const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
		if (permission.status !== "granted") {
			setSettingsError("Photo access is required to pick a profile photo.");
			return;
		}

		let result;
		try {
			result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				allowsEditing: false,
				quality: 0.9,
			});
		} catch (error) {
			setSettingsError(error?.message || "Failed to open photo library.");
			return;
		}

		if (result.canceled) return;
		const asset = result.assets?.[0];
		if (!asset?.uri) return;
		setProfilePictureLocalPreview(String(asset.uri));

		const formData = new FormData();
		formData.append("image", {
			uri: asset.uri,
			name: asset.fileName || "profile.jpg",
			type: asset.mimeType || "image/jpeg",
		});

		try {
			setSettingsBusy(true);
			setSettingsError(null);
			setSettingsInfo("");
			const response = await apiFetch("/auth/profile-photo", {
				method: "POST",
				body: formData,
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Upload failed (${response.status})`);
			}
			let responseOrigin = API_BASE_URL;
			try {
				responseOrigin = new URL(String(response?.url || API_BASE_URL)).origin;
			} catch {
				// Keep API_BASE_URL fallback when parsing fails.
			}
			const nextUser = body?.user
				? {
						...body.user,
						profilePicture: resolveAssetUrl(
							body.user.profilePicture,
							responseOrigin
						),
				  }
				: null;
			await updateAuthUser(nextUser);
			setProfilePictureLocalPreview(String(asset.uri));
			const refreshNonce = Date.now();
			setProfilePictureRefreshNonce(refreshNonce);
			const remoteProfileUri = withCacheBust(
				resolveAssetUrl(nextUser?.profilePicture || "", responseOrigin),
				refreshNonce
			);
			if (remoteProfileUri) {
				Image.prefetch(remoteProfileUri)
					.then(() => setProfilePictureLocalPreview(""))
					.catch(() => {
						// Keep local preview if remote fetch is not ready yet.
					});
			}
			setSettingsInfo("Profile photo updated.");
		} catch (error) {
			setProfilePictureLocalPreview("");
			setSettingsError(error?.message ?? "Failed to upload profile photo.");
		} finally {
			setSettingsBusy(false);
		}
	}, [apiFetch, settingsBusy, updateAuthUser]);

	const handleStartPhoneChange = useCallback(async () => {
		if (settingsBusy) return;
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsInfo("");
		try {
			const response = await apiFetch("/auth/change-phone/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ newPhone: settingsNewPhone.trim() }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Phone change failed (${response.status})`);
			}
			setSettingsInfo("Verification code sent to your current phone.");
		} catch (error) {
			setSettingsError(error?.message ?? "Failed to start phone change.");
		} finally {
			setSettingsBusy(false);
		}
	}, [apiFetch, settingsBusy, settingsNewPhone]);

	const handleVerifyPhoneChange = useCallback(async () => {
		if (settingsBusy) return;
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsInfo("");
		try {
			const response = await apiFetch("/auth/change-phone/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code: settingsPhoneCode.trim() }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Phone verify failed (${response.status})`);
			}
			setIsSettingsOpen(false);
			await clearAuthSession();
		} catch (error) {
			setSettingsError(error?.message ?? "Failed to verify phone change.");
		} finally {
			setSettingsBusy(false);
		}
	}, [apiFetch, clearAuthSession, settingsBusy, settingsPhoneCode]);

	const handleStartPasswordChange = useCallback(async () => {
		if (settingsBusy) return;
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsInfo("");
		try {
			const response = await apiFetch("/auth/change-password/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ newPassword: settingsNewPassword }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Password change failed (${response.status})`);
			}
			setSettingsInfo("Verification code sent to your current phone.");
		} catch (error) {
			setSettingsError(error?.message ?? "Failed to start password change.");
		} finally {
			setSettingsBusy(false);
		}
	}, [apiFetch, settingsBusy, settingsNewPassword]);

	const handleVerifyPasswordChange = useCallback(async () => {
		if (settingsBusy) return;
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsInfo("");
		try {
			const response = await apiFetch("/auth/change-password/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code: settingsPasswordCode.trim() }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(body?.error || `Password verify failed (${response.status})`);
			}
			setSettingsNewPhone("");
			setSettingsPhoneCode("");
			setSettingsNewPassword("");
			setSettingsPasswordCode("");
			setSettingsError(null);
			setSettingsInfo("");
			setIsSettingsOpen(false);
			await clearAuthSession();
		} catch (error) {
			setSettingsError(error?.message ?? "Failed to verify password change.");
		} finally {
			setSettingsBusy(false);
		}
	}, [apiFetch, clearAuthSession, settingsBusy, settingsPasswordCode]);

	// Toggle like in UI optimistically, then persist to backend.
	const toggleLikeById = useCallback(
		async (postId) => {
			let nextLikedValue = null;
			setFeed((prev) =>
				prev.map((p) => {
					if (p.id !== postId) return p;
					const nextLiked = !p.isLiked;
					nextLikedValue = nextLiked;
					const base = p.likesCount ?? p.likes ?? 0;
					const nextCount = Math.max(0, base + (nextLiked ? 1 : -1));
					return {
						...p,
						isLiked: nextLiked,
						likes: nextCount,
						likesCount: nextCount,
					};
				})
			);

			if (nextLikedValue == null) return;

			try {
				const response = await apiFetch(`/feed/${encodeURIComponent(postId)}/like`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ liked: nextLikedValue }),
				});
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `Like failed (${response.status})`);
				}
				setFeed((prev) =>
					prev.map((p) => {
						if (p.id !== postId) return p;
						const persistedLikes = Number(body?.likes ?? p.likesCount ?? p.likes ?? 0);
						return {
							...p,
							isLiked: Boolean(body?.isLiked),
							likes: persistedLikes,
							likesCount: persistedLikes,
						};
					})
				);
			} catch (error) {
				// Roll back optimistic update on failure.
				setFeed((prev) =>
					prev.map((p) => {
						if (p.id !== postId) return p;
						const rolledLiked = !nextLikedValue;
						const base = p.likesCount ?? p.likes ?? 0;
						const rolledCount = Math.max(0, base + (rolledLiked ? 1 : -1));
						return {
							...p,
							isLiked: rolledLiked,
							likes: rolledCount,
							likesCount: rolledCount,
						};
					})
				);
				console.warn("Failed to persist like:", error);
			}
		},
		[apiFetch]
	);

	// Follow state is kept in a ref to avoid forcing immediate re-renders.
	const followedUsersRef = useRef(new Set());

	const toggleFollowByUsername = useCallback(
		async (username) => {
			const targetUsername = String(username || "").trim();
			if (!targetUsername) return;

			const previous = new Set(followedUsersRef.current);
			const next = new Set(previous);
			const nextFollowing = !next.has(targetUsername);
			if (nextFollowing) {
				next.add(targetUsername);
			} else {
				next.delete(targetUsername);
			}
			followedUsersRef.current = next;
			setFollowVersion((v) => v + 1);

			try {
				const response = await apiFetch(
					`/following/${encodeURIComponent(targetUsername)}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ following: nextFollowing }),
					}
				);
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `Follow update failed (${response.status})`);
				}
				const persistedUsernames = Array.isArray(body?.usernames)
					? body.usernames
							.map((name) => String(name || "").trim())
							.filter(Boolean)
					: Array.from(next);
				followedUsersRef.current = new Set(persistedUsernames);
				setFollowVersion((v) => v + 1);
			} catch (error) {
				// Roll back optimistic follow toggle on API failure.
				followedUsersRef.current = previous;
				setFollowVersion((v) => v + 1);
				console.warn("Failed to persist follow:", error);
			}
		},
		[apiFetch]
	);
	const followedUsernames = useMemo(
		() => Array.from(followedUsersRef.current).sort((a, b) => a.localeCompare(b)),
		[followVersion]
	);

	const persistViewById = useCallback(
		async (postId) => {
			if (!postId || pendingViewPostIdsRef.current.has(postId)) return;
			pendingViewPostIdsRef.current.add(postId);
			try {
				const response = await apiFetch(`/feed/${encodeURIComponent(postId)}/view`, {
					method: "POST",
				});
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `View tracking failed (${response.status})`);
				}
				const persistedCount = Number(body?.userViewCount || 0);
				setUserViewCountsById((prev) => ({
					...prev,
					[postId]: Math.max(prev[postId] || 0, persistedCount),
				}));
				setFeed((prev) =>
					prev.map((p) =>
						p.id === postId
							? { ...p, hasSeen: true, userViewCount: Math.max(p.userViewCount || 0, persistedCount) }
							: p
					)
				);
			} catch (error) {
				console.warn("Failed to persist view:", error);
			} finally {
				pendingViewPostIdsRef.current.delete(postId);
			}
		},
		[apiFetch]
	);

	// Consider an item active once most of it is visible.
	const viewabilityConfig = useMemo(
		() => ({
			itemVisiblePercentThreshold: 80,
		}),
		[]
	);

	// Track the topmost visible item index.
	const onViewableItemsChanged = useCallback(({ viewableItems }) => {
		if (!viewableItems.length) return;
		const top = viewableItems[0];
		const topIndex = Number.isInteger(top?.index) ? top.index : 0;
		setActiveIndex(topIndex);
		setMaxIndex((prev) => Math.max(prev, topIndex));
		const postId = top?.item?.id;
		currentVisiblePostIdRef.current = postId || null;
		if (!postId || lastViewedPostIdRef.current === postId) return;
		lastViewedPostIdRef.current = postId;
		setUserViewCountsById((prev) => ({
			...prev,
			[postId]: (prev[postId] || 0) + 1,
		}));
		// ADS (disabled):
		// setAdScoreCount((prev) => {
		// 	let increment = 1;
		// 	if (!adSeenIdsRef.current.has(postId)) {
		// 		adSeenIdsRef.current.add(postId);
		// 		increment += 1;
		// 	}
		// 	const next = prev + increment;
		// 	if (next >= AD_TRIGGER_SCORE) {
		// 		showInterstitialAd();
		// 		return next - AD_TRIGGER_SCORE;
		// 	}
		// 	return next;
		// });
		void persistViewById(postId);
	}, [persistViewById]);

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

	const handleDeleteVideo = useCallback(
		async (postId) => {
			if (!postId || isDeletingVideo) return;
			setIsDeletingVideo(true);
			try {
				const response = await apiFetch(`/feed/${encodeURIComponent(postId)}`, {
					method: "DELETE",
				});
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `Delete failed (${response.status})`);
				}

				setFeed((prev) => prev.filter((p) => p.id !== postId));
				if (commentsPostId === postId) {
					setCommentsOpen(false);
					setCommentsPostId(null);
				}
			} catch (error) {
				console.warn("Failed to delete video:", error);
				setFeedError(error?.message || "Failed to delete video.");
			} finally {
				setIsDeletingVideo(false);
			}
		},
		[apiFetch, commentsPostId, isDeletingVideo]
	);

	const handleDeleteChannel = useCallback(
		async (username) => {
			const target = String(username || "").trim();
			if (!target || isDeletingChannel) return;
			setIsDeletingChannel(true);
			try {
				const response = await apiFetch(
					`/channels/${encodeURIComponent(target)}`,
					{ method: "DELETE" }
				);
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `Delete channel failed (${response.status})`);
				}
				setFeed((prev) => prev.filter((p) => p.username !== target));
				setCommentsOpen(false);
				setCommentsPostId(null);
			} catch (error) {
				console.warn("Failed to delete channel:", error);
				setFeedError(error?.message || "Failed to delete channel.");
			} finally {
				setIsDeletingChannel(false);
			}
		},
		[apiFetch, isDeletingChannel]
	);

	const openUserProfile = useCallback(
		(username) => {
			const target = String(username || "").trim();
			if (!target) return;
			lastFeedEntryRef.current = "manual";
			setPendingFeedIndex(null);
			setPendingFeedPostId(null);
			setIsFollowingListOpen(false);
			setSelectedProfileUsername(target);
			setFeedFilter("all");
			setSearchQuery("");
			setIsSearchOpen(false);
			pagerRef.current?.scrollToIndex({ index: 1, animated: true });
		},
		[]
	);

	// Resolve the post shown in the comments sheet.
	const activeCommentsPost = useMemo(() => {
		return feed.find((p) => p.id === commentsPostId) ?? null;
	}, [feed, commentsPostId]);

	// Append a new comment by persisting to backend first.
	const addCommentToActivePost = useCallback(
		async (text) => {
			if (!commentsPostId) return;
			const trimmed = String(text || "").trim();
			if (!trimmed) return;

			try {
				const response = await apiFetch(
					`/feed/${encodeURIComponent(commentsPostId)}/comments`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ text: trimmed }),
					}
				);
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(body?.error || `Comment failed (${response.status})`);
				}
				const persistedComment = body?.comment;
				const persistedCount = Number(body?.commentsCount);
				if (!persistedComment) {
					throw new Error("Comment API did not return comment payload.");
				}

				setFeed((prev) =>
					prev.map((p) => {
						if (p.id !== commentsPostId) return p;
						const nextComments = [persistedComment, ...(p.comments ?? [])];
						return {
							...p,
							comments: nextComments,
							commentsCount: Number.isFinite(persistedCount)
								? persistedCount
								: (p.commentsCount ?? p.comments?.length ?? 0) + 1,
						};
					})
				);
				setUserCommentCountsById((prev) => ({
					...prev,
					[commentsPostId]: (prev[commentsPostId] || 0) + 1,
				}));
			} catch (error) {
				console.warn("Failed to persist comment:", error);
			}
		},
		[apiFetch, commentsPostId, setFeed]
	);

	const candidateFeed = useMemo(() => {
		const rawBaseFeed =
			feedFilter === "user"
				? feed.filter(
						(post) => post.username === (selectedProfileUsername || currentUser)
					)
				: feed.filter((post) => post.username !== currentUser);
		const baseFeed =
			feedFilter === "user" ? sortByCreatedAtDesc(rawBaseFeed) : rawBaseFeed;
		return getSearchMatchesInOrder(baseFeed, searchQuery);
	}, [feed, feedFilter, searchQuery, currentUser, selectedProfileUsername]);
	const candidateIdsKey = useMemo(
		() => candidateFeed.map((post) => post.id).join("|"),
		[candidateFeed]
	);

	const [recommendedIds, setRecommendedIds] = useState([]);
	const recommendationResult = useMemo(() => {
		if (feedFilter === "user") {
			return {
				rankedIds: candidateFeed.map((post) => post.id),
				evaluation: null,
			};
		}

		const stage1Candidates = generateStage1Candidates({
			items: candidateFeed,
			followedUsers: followedUsersRef.current,
			userCommentCountsById,
			userViewCountsById,
			maxCandidates: Math.max(20, candidateFeed.length),
		});
		const stage1ById = Object.fromEntries(
			stage1Candidates.map((entry) => [entry.post.id, entry])
		);
		const rows = buildTrainingRows(stage1Candidates, userViewCountsById);
		const { train, test } = splitTrainTestRows(rows);

		const toSamples = (items, includeKeywordFeature) =>
			items.map((row) => ({
				postId: row.postId,
				label: row.label,
				features: buildModelFeatures({
					keywordScore: row.entry.keywordScore,
					similarity: row.entry.similarity,
					post: row.entry.post,
					stage1RankIndex: row.stage1RankIndex,
					followedUsers: followedUsersRef.current,
					userCommentCountsById,
					userViewCountsById,
					includeKeywordFeature,
				}),
			}));

		const trainLearned = toSamples(train, false);
		const trainHybrid = toSamples(train, true);
		const testLearned = toSamples(test, false);
		const testHybrid = toSamples(test, true);

		const learnedModel = trainLogisticRegression(
			trainLearned,
			trainLearned[0]?.features?.length || 0
		);
		const hybridModel = trainLogisticRegression(
			trainHybrid,
			trainHybrid[0]?.features?.length || 0
		);

		const learnedScoresById = {};
		const hybridScoresById = {};
		for (const row of testLearned) {
			learnedScoresById[row.postId] = logisticPredict(
				learnedModel.weights,
				row.features
			);
		}
		for (const row of testHybrid) {
			hybridScoresById[row.postId] = logisticPredict(
				hybridModel.weights,
				row.features
			);
		}

		const evaluation = evaluateRecommendationModels({
			rows: test,
			stage1ById,
			learnedScoresById,
			hybridScoresById,
		});

		const reranked = stage1Candidates
			.map((entry, stage1RankIndex) => {
				const learnedFeatures = buildModelFeatures({
					keywordScore: entry.keywordScore,
					similarity: entry.similarity,
					post: entry.post,
					stage1RankIndex,
					followedUsers: followedUsersRef.current,
					userCommentCountsById,
					userViewCountsById,
					includeKeywordFeature: false,
				});
				const hybridFeatures = buildModelFeatures({
					keywordScore: entry.keywordScore,
					similarity: entry.similarity,
					post: entry.post,
					stage1RankIndex,
					followedUsers: followedUsersRef.current,
					userCommentCountsById,
					userViewCountsById,
					includeKeywordFeature: true,
				});
				const learnedProbability = learnedFeatures.length
					? logisticPredict(learnedModel.weights, learnedFeatures)
					: 0;
				const hybridProbability = hybridFeatures.length
					? logisticPredict(hybridModel.weights, hybridFeatures)
					: 0;

				return {
					id: entry.post.id,
					hasSeen: !!entry.post.hasSeen,
					stage1Score: entry.keywordScore,
					learnedProbability,
					hybridProbability,
					finalScore: hybridProbability * 0.85 + learnedProbability * 0.15,
				};
			})
			.sort((a, b) => {
				if (a.hasSeen !== b.hasSeen) return a.hasSeen ? 1 : -1;
				if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
				return b.stage1Score - a.stage1Score;
			});

		return {
			rankedIds: reranked.map((row) => row.id),
			evaluation,
		};
	}, [
		candidateFeed,
		feedFilter,
		followVersion,
		userCommentCountsById,
		userViewCountsById,
	]);

	useEffect(() => {
		setRecommendedIds((prev) => {
			const nextRanked = recommendationResult.rankedIds;
			if (!nextRanked.length) return [];
			if (feedFilter === "user") return nextRanked;
			if (!prev.length) return nextRanked;

			const validIds = new Set(nextRanked);
			const seen = new Set();
			const freezeCount = Math.min(prev.length, Math.max(0, maxIndex) + 1);
			const frozenPrefix = [];
			for (const id of prev.slice(0, freezeCount)) {
				if (!validIds.has(id) || seen.has(id)) continue;
				seen.add(id);
				frozenPrefix.push(id);
			}

			const tail = [];
			for (const id of nextRanked) {
				if (seen.has(id)) continue;
				seen.add(id);
				tail.push(id);
			}

			const merged = [...frozenPrefix, ...tail];
			const currentVisibleId = currentVisiblePostIdRef.current;
			if (
				currentVisibleId &&
				validIds.has(currentVisibleId) &&
				merged[Math.max(0, activeIndex)] !== currentVisibleId
			) {
				const sourceIdx = merged.indexOf(currentVisibleId);
				if (sourceIdx >= 0) {
					const targetIdx = Math.min(
						Math.max(0, activeIndex),
						merged.length - 1
					);
					const [picked] = merged.splice(sourceIdx, 1);
					merged.splice(targetIdx, 0, picked);
				}
			}

			return merged;
		});
	}, [activeIndex, feedFilter, maxIndex, recommendationResult.rankedIds]);

	useEffect(() => {
		const e = recommendationResult.evaluation;
		if (!e) return;
		const signature = JSON.stringify([
			e.keywordLikeRate,
			e.learnedLikeRate,
			e.hybridLikeRate,
			e.keywordAuc,
			e.learnedAuc,
			e.hybridAuc,
			e.improvementPct,
		]);
		if (lastRecommendationSignatureRef.current === signature) return;
		lastRecommendationSignatureRef.current = signature;
		const improvementText =
			e.improvementPct == null ? "n/a" : `${e.improvementPct.toFixed(1)}%`;
		console.log(
			`[Recommender Eval] like@${e.k}: keyword=${((e.keywordLikeRate || 0) * 100).toFixed(1)}% learned=${((e.learnedLikeRate || 0) * 100).toFixed(1)}% hybrid=${((e.hybridLikeRate || 0) * 100).toFixed(1)}% | auc: keyword=${(e.keywordAuc || 0).toFixed(3)} learned=${(e.learnedAuc || 0).toFixed(3)} hybrid=${(e.hybridAuc || 0).toFixed(3)} | hybrid improvement=${improvementText}`
		);
	}, [recommendationResult.evaluation]);

	useEffect(() => {
		if (lastFeedEntryRef.current === "profileVideo") {
			shouldScrollToTopRef.current = false;
			return;
		}
		shouldScrollToTopRef.current = true;
		setActiveIndex(0);
		setMaxIndex(0);
	}, [candidateIdsKey, searchQuery]);

	const filteredFeed = useMemo(() => {
		if (feedFilter === "user") {
			const seen = new Set();
			return candidateFeed.filter((post) => {
				if (seen.has(post.id)) return false;
				seen.add(post.id);
				return true;
			});
		}
		if (!recommendedIds.length) return [];
		const byId = new Map(candidateFeed.map((post) => [post.id, post]));
		const ordered = recommendedIds.map((id) => byId.get(id)).filter(Boolean);
		const seen = new Set();
		return ordered.filter((post) => {
			if (seen.has(post.id)) return false;
			seen.add(post.id);
			return true;
		});
	}, [candidateFeed, feedFilter, recommendedIds]);

	useEffect(() => {
		if (!shouldScrollToTopRef.current) return;
		if (!filteredFeed.length) return;
		try {
			feedListRef.current?.scrollToIndex({ index: 0, animated: false });
		} catch {
			// FlatList may not be ready on the first frame.
		}
		shouldScrollToTopRef.current = false;
	}, [filteredFeed.length]);

	useEffect(() => {
		if (!filteredFeed.length) {
			setActiveIndex(0);
			return;
		}
		if (activeIndex >= filteredFeed.length) {
			setActiveIndex(0);
		}
	}, [activeIndex, filteredFeed.length]);

	const viewedProfileUsername = selectedProfileUsername || currentUser;
	const isOwnProfileView = viewedProfileUsername === currentUser;
	const profileVideos = useMemo(() => {
		return sortByCreatedAtDesc(
			feed.filter((post) => post.username === viewedProfileUsername)
		);
	}, [feed, viewedProfileUsername]);

	const handleProfileVideoPress = useCallback((postId) => {
		const tappedPostId = String(postId || "").trim();
		if (!tappedPostId) return;
		lastFeedEntryRef.current = "profileVideo";
		setPendingFeedIndex(null);
		setPendingFeedPostId(tappedPostId);
		setSelectedProfileUsername(viewedProfileUsername);
		setFeedFilter("user");
		setSearchQuery("");
		setIsSearchOpen(false);
		pagerRef.current?.scrollToIndex({ index: 0, animated: true });
		setMaxIndex(0);
		setActiveIndex(0);
	}, [viewedProfileUsername]);

	useEffect(() => {
		if (feedFilter !== "user") return;
		if (!filteredFeed.length) return;
		if (pendingFeedIndex == null && !pendingFeedPostId) return;

		let targetIndex = 0;
		if (pendingFeedPostId) {
			const foundIndex = filteredFeed.findIndex((post) => post.id === pendingFeedPostId);
			if (foundIndex >= 0) {
				targetIndex = foundIndex;
			} else if (pendingFeedIndex != null) {
				targetIndex = Math.min(Math.max(0, pendingFeedIndex), filteredFeed.length - 1);
			}
		} else if (pendingFeedIndex != null) {
			targetIndex = Math.min(Math.max(0, pendingFeedIndex), filteredFeed.length - 1);
		}

		feedListRef.current?.scrollToIndex({
			index: targetIndex,
			animated: false,
		});
		setActiveIndex(targetIndex);
		setPendingFeedIndex(null);
		setPendingFeedPostId(null);
	}, [feedFilter, filteredFeed, pendingFeedIndex, pendingFeedPostId]);

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
			{/* ADS (disabled): AdFallbackModal removed until AdMob approval */}
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
						<Text style={styles.aivaModalLabel}>Script</Text>
						<TextInput
							value={aivaScriptText}
							onChangeText={setAivaScriptText}
							placeholder="Write the story or narration direction..."
							placeholderTextColor="rgba(255,255,255,0.5)"
							multiline
							style={styles.aivaModalInput}
						/>
						<Text style={styles.aivaHintText}>
							Upload up to {MAX_AIVA_IMAGES} images. The final video uses {AIVA_SECONDS_PER_IMAGE}s per image
							with ElevenLabs narration over your script.
						</Text>
						<Text style={styles.aivaModalLabel}>Images (up to {MAX_AIVA_IMAGES})</Text>
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
								{aivaImages.length} selected
							</Text>
						</View>
						{aivaImages.length > 0 && (
							<View style={styles.aivaPreviewRow}>
								{aivaImages.map((img) => (
									<View key={img.id} style={styles.aivaPreviewItem}>
										<Image source={{ uri: img.uri }} style={styles.aivaPreview} />
										<TouchableOpacity
											onPress={() => removeAivaImage(img.id)}
											activeOpacity={0.8}
											style={styles.aivaRemoveButton}
										>
											<Text style={styles.aivaRemoveText}>✕</Text>
										</TouchableOpacity>
									</View>
								))}
							</View>
						)}
						<Text style={styles.aivaHintText}>
							Use up to {MAX_AIVA_IMAGES} images. At {AIVA_SECONDS_PER_IMAGE}s each, 12 images make ~1 minute.
						</Text>
						{aivaError ? (
							<Text style={styles.aivaErrorText}>{aivaError}</Text>
						) : null}
						<View style={styles.aivaModalActions}>
							{/* ADS (disabled): watch-ad button removed until AdMob approval */}
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
							<TouchableOpacity
								onPress={() => setIsAivaPromptOpen(false)}
								activeOpacity={0.9}
								style={styles.aivaModalButton}
							>
								<Text style={styles.aivaModalButtonText}>Cancel</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
			<Modal
				transparent
				visible={isSettingsOpen}
				animationType="fade"
				onRequestClose={() => setIsSettingsOpen(false)}
			>
				<View style={styles.aivaModalBackdrop}>
						<View style={styles.aivaModalCard}>
							<Text style={styles.aivaModalTitle}>Settings</Text>
							<Text style={styles.aivaModalLabel}>Profile photo</Text>
							<View style={styles.aivaModalActions}>
								<TouchableOpacity
									onPress={handlePickProfilePhoto}
									disabled={settingsBusy}
									activeOpacity={0.9}
									style={[
										styles.aivaModalButton,
										styles.aivaModalButtonPrimary,
										settingsBusy && styles.aivaModalButtonDisabled,
									]}
								>
									<Text style={styles.aivaModalButtonText}>
										{settingsBusy ? "Uploading..." : "Upload Profile Photo"}
									</Text>
								</TouchableOpacity>
							</View>

							<Text style={styles.aivaModalLabel}>Change phone number</Text>
							<TextInput
								value={settingsNewPhone}
							onChangeText={setSettingsNewPhone}
							placeholder="+15551234567"
							placeholderTextColor="rgba(255,255,255,0.5)"
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="phone-pad"
							style={styles.aivaModalInput}
						/>
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={handleStartPhoneChange}
								disabled={settingsBusy}
								activeOpacity={0.9}
								style={[styles.aivaModalButton, styles.aivaModalButtonPrimary]}
							>
								<Text style={styles.aivaModalButtonText}>Send Code</Text>
							</TouchableOpacity>
						</View>
						<TextInput
							value={settingsPhoneCode}
							onChangeText={setSettingsPhoneCode}
							placeholder="Enter verification code"
							placeholderTextColor="rgba(255,255,255,0.5)"
							keyboardType="number-pad"
							style={styles.aivaModalInput}
						/>
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={handleVerifyPhoneChange}
								disabled={settingsBusy}
								activeOpacity={0.9}
								style={[styles.aivaModalButton, styles.aivaModalButtonPrimary]}
							>
								<Text style={styles.aivaModalButtonText}>Verify Phone</Text>
							</TouchableOpacity>
						</View>

						<Text style={styles.aivaModalLabel}>Change password</Text>
						<TextInput
							value={settingsNewPassword}
							onChangeText={setSettingsNewPassword}
							placeholder="New password"
							placeholderTextColor="rgba(255,255,255,0.5)"
							secureTextEntry
							style={styles.aivaModalInput}
						/>
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={handleStartPasswordChange}
								disabled={settingsBusy}
								activeOpacity={0.9}
								style={[styles.aivaModalButton, styles.aivaModalButtonPrimary]}
							>
								<Text style={styles.aivaModalButtonText}>Send Code</Text>
							</TouchableOpacity>
						</View>
						<TextInput
							value={settingsPasswordCode}
							onChangeText={setSettingsPasswordCode}
							placeholder="Enter verification code"
							placeholderTextColor="rgba(255,255,255,0.5)"
							keyboardType="number-pad"
							style={styles.aivaModalInput}
						/>
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={handleVerifyPasswordChange}
								disabled={settingsBusy}
								activeOpacity={0.9}
								style={[styles.aivaModalButton, styles.aivaModalButtonPrimary]}
							>
								<Text style={styles.aivaModalButtonText}>Verify Password</Text>
							</TouchableOpacity>
						</View>

						{settingsInfo ? (
							<Text style={styles.authDevCode}>{settingsInfo}</Text>
						) : null}
						{settingsError ? (
							<Text style={styles.aivaErrorText}>{settingsError}</Text>
						) : null}

						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={() => setIsSettingsOpen(false)}
								activeOpacity={0.9}
								style={styles.aivaModalButton}
							>
								<Text style={styles.aivaModalButtonText}>Close</Text>
							</TouchableOpacity>
						</View>
						<TouchableOpacity
							onPress={handleLogout}
							disabled={settingsBusy}
							activeOpacity={0.9}
							style={[styles.aivaModalButton, styles.settingsLogoutButton]}
						>
							<Text style={styles.aivaModalButtonText}>Logout</Text>
						</TouchableOpacity>
					</View>
				</View>
			</Modal>
			<Modal
				transparent
				visible={isFollowingListOpen}
				animationType="fade"
				onRequestClose={() => setIsFollowingListOpen(false)}
			>
				<View style={styles.aivaModalBackdrop}>
					<View style={styles.aivaModalCard}>
						<Text style={styles.aivaModalTitle}>Following</Text>
						{followedUsernames.length === 0 ? (
							<Text style={styles.followedListEmpty}>
								You are not following anyone yet.
							</Text>
						) : (
							<FlatList
								data={followedUsernames}
								keyExtractor={(username) => username}
								renderItem={({ item: username }) => (
									<TouchableOpacity
										onPress={() => openUserProfile(username)}
										activeOpacity={0.9}
										style={styles.followedListItem}
									>
										<Text style={styles.followedListText}>@{username}</Text>
									</TouchableOpacity>
								)}
								style={styles.followedList}
								contentContainerStyle={styles.followedListContent}
								showsVerticalScrollIndicator={false}
							/>
						)}
						<View style={styles.aivaModalActions}>
							<TouchableOpacity
								onPress={() => setIsFollowingListOpen(false)}
								activeOpacity={0.9}
								style={styles.aivaModalButton}
							>
								<Text style={styles.aivaModalButtonText}>Close</Text>
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
									<Text style={styles.profileTitle}>
										{isOwnProfileView ? "Profile" : `@${viewedProfileUsername}`}
									</Text>
									<View style={styles.profileTopActions}>
										{isOwnProfileView ? (
											<>
												<Text style={styles.aivaTopVideosLeftText}>
													{aivaVideosLeft} left
												</Text>
												<TouchableOpacity
													onPress={() => {
														setAivaError(null);
														void loadAivaStatus();
														setIsAivaPromptOpen(true);
													}}
													hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
													style={styles.aivaSettingsButton}
												>
													<Text style={styles.aivaSettingsIcon}>✨</Text>
												</TouchableOpacity>
												<TouchableOpacity
													onPress={() => {
														setSettingsError(null);
														setSettingsInfo("");
														setIsSettingsOpen(true);
													}}
													hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
													style={styles.settingsButton}
												>
													<Text style={styles.settingsIcon}>⚙</Text>
												</TouchableOpacity>
											</>
										) : (
											<TouchableOpacity
												onPress={() => {
													setSelectedProfileUsername(currentUser);
												}}
												hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
												style={styles.settingsButton}
											>
												<Text style={styles.settingsIcon}>←</Text>
											</TouchableOpacity>
										)}
									</View>
								</View>
								<View style={styles.profileHeader}>
									<TouchableOpacity
										onPress={handlePickProfilePhoto}
										activeOpacity={0.9}
										style={styles.profileAvatar}
									>
										{displayedProfilePicture ? (
											<Image
												source={{ uri: displayedProfilePicture }}
												style={styles.profileAvatarImage}
											/>
										) : (
											<Text style={styles.profileAvatarText}>
												{(currentUser?.[0] || "?").toUpperCase()}
											</Text>
										)}
									</TouchableOpacity>
									<Text style={styles.profileUsername}>@{viewedProfileUsername}</Text>
									{isOwnProfileView && currentUser.toLowerCase() === "andrewr" ? (
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
											{profileVideos.length}
										</Text>
										<Text style={styles.profileStatLabel}>Videos</Text>
									</View>
									<View style={styles.profileStat}>
										<Text style={styles.profileStatValue}>0</Text>
										<Text style={styles.profileStatLabel}>Followers</Text>
									</View>
									<TouchableOpacity
										onPress={() => {
											if (!isOwnProfileView) return;
											setIsFollowingListOpen(true);
										}}
										activeOpacity={0.85}
										disabled={!isOwnProfileView}
										style={[
											styles.profileStat,
											isOwnProfileView && styles.profileStatButton,
										]}
									>
										<Text style={styles.profileStatValue}>
											{isOwnProfileView ? followedUsernames.length : 0}
										</Text>
										<Text style={styles.profileStatLabel}>Following</Text>
									</TouchableOpacity>
								</View>
								<View style={styles.profileTabRow}>
									<Text style={styles.profileTabActive}>Videos</Text>
								</View>
									<FlatList
										data={profileVideos}
										keyExtractor={(video) => video.id}
										numColumns={3}
										renderItem={({ item: video }) => (
											<TouchableOpacity
												onPress={() => handleProfileVideoPress(video.id)}
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
										setSelectedProfileUsername(currentUser);
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
										onOpenUserProfile={openUserProfile}
										onDeleteVideo={handleDeleteVideo}
										onDeleteChannel={handleDeleteChannel}
										followedUsersRef={followedUsersRef}
										currentUser={currentUser}
									/>
								)}
								extraData={followVersion}
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
	adBackdrop: {
		flex: 1,
		backgroundColor: "rgba(0,0,0,0.72)",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 20,
	},
	adCard: {
		width: "100%",
		maxWidth: 420,
		borderRadius: 16,
		padding: 18,
		backgroundColor: "#0f1118",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.16)",
	},
	adBadge: {
		alignSelf: "flex-start",
		color: "#d7e2ff",
		backgroundColor: "rgba(47,131,255,0.22)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
		fontWeight: "700",
		fontSize: 12,
		marginBottom: 10,
	},
	adTitle: {
		color: "white",
		fontSize: 22,
		fontWeight: "800",
	},
	adText: {
		color: "rgba(255,255,255,0.88)",
		marginTop: 8,
		lineHeight: 20,
	},
	adMeta: {
		color: "rgba(255,255,255,0.62)",
		marginTop: 8,
		fontSize: 12,
	},
	adCloseButton: {
		marginTop: 16,
		paddingVertical: 12,
		borderRadius: 10,
		alignItems: "center",
		backgroundColor: "#2f83ff",
	},
	adCloseButtonText: {
		color: "white",
		fontWeight: "700",
	},
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
	usernameButton: {
		paddingVertical: 2,
	},
	username: { color: "white", fontWeight: "800", fontSize: 16 },
	caption: { color: "white", marginTop: 6 },
	audio: { color: "rgba(255,255,255,0.8)", marginTop: 4 },
	deleteVideoButton: {
		marginTop: 10,
		alignSelf: "flex-start",
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 999,
		backgroundColor: "rgba(255,80,80,0.25)",
		borderWidth: 1,
		borderColor: "rgba(255,80,80,0.6)",
	},
	deleteVideoButtonText: {
		color: "white",
		fontSize: 12,
		fontWeight: "700",
	},
	deleteChannelButton: {
		marginTop: 8,
		alignSelf: "flex-start",
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 999,
		backgroundColor: "rgba(255,40,40,0.25)",
		borderWidth: 1,
		borderColor: "rgba(255,40,40,0.7)",
	},
	deleteChannelButtonText: {
		color: "white",
		fontSize: 12,
		fontWeight: "700",
	},
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
		alignItems: "center",
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
	// ADS (disabled):
	// aivaRewardAdButton: {
	// 	backgroundColor: "rgba(255,179,71,0.22)",
	// 	borderWidth: 1,
	// 	borderColor: "rgba(255,179,71,0.55)",
	// },
	settingsLogoutButton: {
		marginTop: 10,
		alignSelf: "stretch",
		alignItems: "center",
		backgroundColor: "#ff4d5e",
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
	followedList: {
		maxHeight: 280,
		marginBottom: 8,
	},
	followedListContent: {
		paddingBottom: 4,
	},
	followedListItem: {
		paddingHorizontal: 12,
		paddingVertical: 12,
		borderRadius: 10,
		backgroundColor: "rgba(255,255,255,0.08)",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.12)",
		marginBottom: 8,
	},
	followedListText: {
		color: "white",
		fontSize: 14,
		fontWeight: "600",
	},
	followedListEmpty: {
		color: "rgba(255,255,255,0.68)",
		marginBottom: 12,
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
	aivaTopVideosLeftText: {
		color: "rgba(255,255,255,0.8)",
		fontSize: 12,
		fontWeight: "600",
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
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
	},
	profileAvatarImage: {
		width: "100%",
		height: "100%",
	},
	profileAvatarText: {
		color: "white",
		fontSize: 30,
		fontWeight: "800",
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
	profileStatButton: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 10,
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
