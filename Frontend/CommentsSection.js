import React, { useEffect, useMemo, useRef } from "react";
import {
	View,
	Text,
	StyleSheet,
	Animated,
	Easing,
	Dimensions,
	TouchableOpacity,
} from "react-native";
import Comments from "./Comments";

const { height: H } = Dimensions.get("window");
const SHEET_H = Math.min(H * 0.78, 640);

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

export default function CommentsSection({
	visible,
	post,
	onClose,
	onAddComment,
}) {
	const translateY = useRef(new Animated.Value(SHEET_H)).current; // start offscreen
	const backdropOpacity = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (visible) {
			Animated.parallel([
				Animated.timing(backdropOpacity, {
					toValue: 1,
					duration: 180,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(translateY, {
					toValue: 0,
					duration: 220,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
			]).start();
		} else {
			Animated.parallel([
				Animated.timing(backdropOpacity, {
					toValue: 0,
					duration: 160,
					easing: Easing.in(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(translateY, {
					toValue: SHEET_H,
					duration: 200,
					easing: Easing.in(Easing.cubic),
					useNativeDriver: true,
				}),
			]).start();
		}
	}, [visible, backdropOpacity, translateY]);

	// If it's not visible AND fully offscreen, you can optionally not render.
	// But simplest is: always render when parent passes it in.
	const title = useMemo(() => {
		const n = post?.commentsCount ?? post?.comments?.length ?? 0;
		const displayCount = n >= 10000 ? convertNumberToLetter(n) : String(n);
		return `Comments (${displayCount})`;
	}, [post]);

	return (
		<View
			pointerEvents={visible ? "auto" : "none"}
			style={StyleSheet.absoluteFill}
		>
			{/* Backdrop */}
			<Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />

			{/* Sheet */}
			<Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{title}</Text>

					<TouchableOpacity
						onPress={onClose}
						hitSlop={12}
						style={styles.closeBtn}
					>
						<Text style={styles.closeText}>✕</Text>
					</TouchableOpacity>
				</View>

				<View style={styles.divider} />

				<Comments comments={post?.comments ?? []} onAddComment={onAddComment} />
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0,0,0,0.55)",
	},
	sheet: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: SHEET_H,
		backgroundColor: "rgba(15,15,15,0.98)",
		borderTopLeftRadius: 18,
		borderTopRightRadius: 18,
		overflow: "hidden",
	},
	header: {
		height: 52,
		paddingHorizontal: 14,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
	},
	headerTitle: { color: "white", fontWeight: "900", fontSize: 16 },
	closeBtn: {
		position: "absolute",
		right: 10,
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(255,255,255,0.08)",
	},
	closeText: { color: "white", fontSize: 16, fontWeight: "900" },
	divider: { height: 1, backgroundColor: "rgba(255,255,255,0.10)" },
});
