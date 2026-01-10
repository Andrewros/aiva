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
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

const { height: H, width: W } = Dimensions.get("window");

const FEED = [
	{
		id: "1",
		username: "andrew",
		caption: "expo-video ✅",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
		likes: 5463066,
		comments: 409583,
	},
	{
		id: "2",
		username: "osu",
		caption: "Smooth vertical feed",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
		likes: 3066,
		comments: 4039583,
	},
	{
		id: "3",
		username: "bmr",
		caption: "Auto-play only active video",
		audio: "Original audio",
		uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
		likes: 66,
		comments: 39583,
	},
];

// 1534 -> "1.5k", up to 1T
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

function VideoPost({ item, active }) {
	const player = useVideoPlayer(item.uri, (player) => {
		player.loop = true;
		player.muted = false;
	});

	const [paused, setPaused] = useState(false);
	const [liked, setLiked] = useState(false);

	// Like pop animation
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

	// NEW: play/pause icon overlay animation
	const playPauseOpacity = useRef(new Animated.Value(0)).current; // 0 hidden -> 1 visible
	const playPauseScale = useRef(new Animated.Value(1)).current;
	const hideTimerRef = useRef(null);

	const showPlayPauseIcon = useCallback(
		(mode) => {
			// mode: "pause" | "play"
			// show icon, then:
			//  - if pause: stay visible (until next toggle)
			//  - if play: hide after ~0.5s
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
		return () => {
			// cleanup timer on unmount
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, []);

	// Auto-play only when visible
	useEffect(() => {
		if (active) {
			player.play();
			setPaused(false);
			// optional: don't show play icon when auto-playing
			// showPlayPauseIcon("play");
		} else {
			player.pause();
			player.currentTime = 0;
			setPaused(false);
			// hide icon when offscreen
			playPauseOpacity.setValue(0);
		}
	}, [active, player, playPauseOpacity]);

	const onToggleVideo = useCallback(() => {
		if (paused) {
			player.play();
			setPaused(false);
			showPlayPauseIcon("play"); // show briefly
		} else {
			player.pause();
			setPaused(true);
			showPlayPauseIcon("pause"); // stay visible
		}
	}, [paused, player, showPlayPauseIcon]);

	const onPressLike = useCallback(() => {
		setLiked((prev) => !prev);
		runLikePop();
	}, [runLikePop]);

	return (
		<View style={styles.page}>
			{/* Tap anywhere EXCEPT the right rail to pause/play */}
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

			{/* NEW: play/pause icon overlay (center) */}
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
				{/* Use text icons so you don't need extra libs */}
				<Text style={styles.playPauseIcon}>
					{/* when paused: show play icon; when playing: show pause icon briefly */}
					{paused ? "▶" : "❚❚"}
				</Text>
			</Animated.View>

			{/* Overlay UI (touchable, stops the outer tap from firing) */}
			<View style={styles.rightRail} pointerEvents="box-none">
				<TouchableOpacity
					activeOpacity={0.85}
					onPress={onPressLike}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					<Text style={[styles.icon, liked && styles.iconLiked]}>
						{liked ? "♥" : "♡"}
					</Text>
					<Text style={styles.count}>{convertNumberToLetter(item.likes)}</Text>
				</TouchableOpacity>

				<TouchableOpacity
					activeOpacity={0.85}
					onPress={() => console.log("comments")}
					hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
					style={styles.railButton}
				>
					<Text style={styles.icon}>💬</Text>
					<Text style={styles.count}>
						{convertNumberToLetter(item.comments)}
					</Text>
				</TouchableOpacity>

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

			{/* Like popup "pop" animation */}
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

			<View style={styles.bottomMeta} pointerEvents="none">
				<Text style={styles.username}>@{item.username}</Text>
				<Text style={styles.caption}>{item.caption}</Text>
				<Text style={styles.audio}>♫ {item.audio}</Text>
			</View>
		</View>
	);
}

export default function App() {
	const [activeIndex, setActiveIndex] = useState(0);

	const viewabilityConfig = useMemo(
		() => ({
			itemVisiblePercentThreshold: 80,
		}),
		[]
	);

	const onViewableItemsChanged = useRef(({ viewableItems }) => {
		if (!viewableItems.length) return;
		setActiveIndex(viewableItems[0].index);
	}).current;

	return (
		<View style={styles.container}>
			<StatusBar
				translucent
				backgroundColor="transparent"
				barStyle="light-content"
			/>

			<FlatList
				data={FEED}
				keyExtractor={(item) => item.id}
				renderItem={({ item, index }) => (
					<VideoPost item={item} active={index === activeIndex} />
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

	// NEW: centered play/pause icon overlay
	playPauseOverlay: {
		position: "absolute",
		alignSelf: "center",
		top: H / 2 - 34,
		width: 68,
		height: 68,
		borderRadius: 34,
		backgroundColor: "rgba(0,0,0,0.35)", // slightly transparent
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
});
