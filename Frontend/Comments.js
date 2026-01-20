import React, { useMemo, useState } from "react";
import {
	View,
	Text,
	StyleSheet,
	FlatList,
	TextInput,
	TouchableOpacity,
} from "react-native";

function timeAgo(iso) {
	if (!iso) return "";
	const d = new Date(iso);
	const diff = Date.now() - d.getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	const days = Math.floor(hrs / 24);
	return `${days}d`;
}

export default function Comments({ comments = [], onAddComment }) {
	const [text, setText] = useState("");

	const data = useMemo(() => comments ?? [], [comments]);

	const submit = () => {
		const t = text.trim();
		if (!t) return;
		onAddComment?.(t);
		setText("");
	};

	return (
		<View style={styles.wrap}>
			<FlatList
				data={data}
				keyExtractor={(item) => String(item.id)}
				contentContainerStyle={styles.listContent}
				renderItem={({ item }) => (
					<View style={styles.commentRow}>
						<View style={styles.avatar} />
						<View style={styles.commentBody}>
							<View style={styles.commentHeader}>
								<Text style={styles.user}>@{item.user}</Text>
								<Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
							</View>
							<Text style={styles.text}>{item.text}</Text>
							<View style={styles.metaRow}>
								<Text style={styles.meta}>♥ {item.likes ?? 0}</Text>
							</View>
						</View>
					</View>
				)}
			/>

			<View style={styles.inputRow}>
				<TextInput
					value={text}
					onChangeText={setText}
					placeholder="Add a comment..."
					placeholderTextColor="rgba(255,255,255,0.5)"
					style={styles.input}
					returnKeyType="send"
					onSubmitEditing={submit}
				/>
				<TouchableOpacity
					onPress={submit}
					activeOpacity={0.85}
					style={styles.sendBtn}
				>
					<Text style={styles.sendText}>Send</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { flex: 1 },
	listContent: { padding: 16, paddingBottom: 90 },
	commentRow: { flexDirection: "row", marginBottom: 14 },
	avatar: {
		width: 34,
		height: 34,
		borderRadius: 17,
		backgroundColor: "rgba(255,255,255,0.18)",
		marginRight: 10,
	},
	commentBody: { flex: 1 },
	commentHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
	user: { color: "white", fontWeight: "800" },
	time: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
	text: { color: "rgba(255,255,255,0.92)", marginTop: 2 },
	metaRow: { flexDirection: "row", marginTop: 6 },
	meta: { color: "rgba(255,255,255,0.6)", fontSize: 12 },

	inputRow: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderTopWidth: 1,
		borderTopColor: "rgba(255,255,255,0.10)",
		backgroundColor: "rgba(0,0,0,0.92)",
	},
	input: {
		flex: 1,
		height: 40,
		borderRadius: 20,
		paddingHorizontal: 14,
		backgroundColor: "rgba(255,255,255,0.10)",
		color: "white",
	},
	sendBtn: {
		marginLeft: 10,
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: 16,
		backgroundColor: "rgba(255,255,255,0.14)",
	},
	sendText: { color: "white", fontWeight: "800" },
});
