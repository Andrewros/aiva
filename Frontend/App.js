import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
	View,
	Text,
	StyleSheet,
	Dimensions,
	FlatList,
	TouchableWithoutFeedback,
	TouchableOpacity,
	StatusBar,
	Animated,
	Easing,
	TextInput,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import CommentsSection from "./CommentsSection";

// Screen size used to size pages/videos for a full-screen vertical feed.
const { height: H, width: W } = Dimensions.get("window");
// Mock feed data with post metadata and comment samples.
const FEED = [
	{
		id: "1",
		username: "andrew",
		caption: "expo-video for bmr✅",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
		likes: 5463066,
		comments: [
			{
				id: "c1",
				user: "osuFan",
				text: "This looks smooth 🔥",
				likes: 120,
				createdAt: "2026-01-10T14:01:00Z",
			},
			{
				id: "c2",
				user: "devguy",
				text: "expo-video is so nice compared to expo-av",
				likes: 88,
				createdAt: "2026-01-10T14:03:00Z",
			},
			{
				id: "c3",
				user: "alex",
				text: "That like animation is clean",
				likes: 42,
				createdAt: "2026-01-10T14:05:00Z",
			},
		],
		commentsCount: 5472,
	},
	{
		id: "2",
		username: "osu",
		caption: "Smooth vertical feed",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
		likes: 3066,
		comments: [
			{
				id: "c1",
				user: "michTransfer",
				text: "Scrolling feels like TikTok 👏",
				likes: 15,
				createdAt: "2026-01-10T14:10:00Z",
			},
			{
				id: "c2",
				user: "uiux",
				text: "Rail spacing is perfect",
				likes: 7,
				createdAt: "2026-01-10T14:11:00Z",
			},
		],
		commentsCount: 4039583,
	},
	{
		id: "3",
		username: "bmr",
		caption: "Auto-play only active video",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
		likes: 66,
		comments: [
			{
				id: "c1",
				user: "sam",
				text: "Autoplay logic works great",
				likes: 3,
				createdAt: "2026-01-10T14:20:00Z",
			},
			{
				id: "c2",
				user: "andrew",
				text: "Next: add a comments modal 😈",
				likes: 5,
				createdAt: "2026-01-10T14:22:00Z",
			},
			{
				id: "c3",
				user: "qa",
				text: "Does this reset time when offscreen? (it should)",
				likes: 2,
				createdAt: "2026-01-10T14:24:00Z",
			},
		],
		commentsCount: 39583,
	},
];

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

// Renders a single full-screen video cell with engagement actions.
function VideoPost({ item, active, likesCount, onToggleLike, onOpenComments }) {
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
			<View style={styles.bottomMeta} pointerEvents="none">
				<Text style={styles.username}>@{item.username}</Text>
				<Text style={styles.caption}>{item.caption}</Text>
				<Text style={styles.audio}>♫ {item.audio}</Text>
			</View>
		</View>
	);
}

export default function App() {
	// Active index controls which item should auto-play.
	const [activeIndex, setActiveIndex] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);

	// Local feed state to store per-item likes and comments.
	const [feed, setFeed] = useState(() =>
		FEED.map((p) => ({
			...p,
			isLiked: false,
			likesCount: p.likes,
		}))
	);

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
		return getSearchMatchesInOrder(feed, searchQuery);
	}, [feed, searchQuery]);

	useEffect(() => {
		setActiveIndex(0);
	}, [searchQuery]);
	return (
		<View style={styles.container}>
			{/* Transparent status bar for immersive video */}
			<StatusBar
				translucent
				backgroundColor="transparent"
				barStyle="light-content"
			/>

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

			{/* Full-screen, paged vertical feed */}
			<FlatList
				data={filteredFeed}
				keyExtractor={(item) => item.id}
				renderItem={({ item, index }) => (
					<VideoPost
						item={item}
						active={index === activeIndex}
						likesCount={item.likesCount}
						onToggleLike={toggleLikeById}
						onOpenComments={openCommentsFor}
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
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "black" },
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
	username: { color: "white", fontWeight: "800", fontSize: 16 },
	caption: { color: "white", marginTop: 6 },
	audio: { color: "rgba(255,255,255,0.8)", marginTop: 4 },

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
});
