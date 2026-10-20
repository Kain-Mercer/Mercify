// A full-width camera view that reads the pairing QR. Loaded defensively, so if the native camera
// module isn't in the build the app shows a message instead of crashing (and the typed code still
// works).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, PermissionsAndroid, Platform, StyleSheet } from "react-native";

let Camera = null;
try {
	Camera = require("react-native-camera-kit").Camera;
} catch (_) {}

// Whether a camera module is in this build, so the UI can hide the Scan button when it isn't.
export const cameraAvailable = !!Camera;

function Centered({ color, children }) {
	return (
		<View style={styles.center}>
			<Text style={{ color, textAlign: "center", paddingHorizontal: 20 }}>{children}</Text>
		</View>
	);
}

export default function QRScanner({ onScanned, onCancel, theme }) {
	const C = theme;
	const [granted, setGranted] = useState(Platform.OS !== "android");
	const [denied, setDenied] = useState(false);
	const [done, setDone] = useState(false);

	useEffect(() => {
		if (Platform.OS !== "android") return;
		PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
			.then((r) => (r === PermissionsAndroid.RESULTS.GRANTED ? setGranted(true) : setDenied(true)))
			.catch(() => setDenied(true));
	}, []);

	const handle = (code) => {
		if (done || !code) return;
		setDone(true);
		onScanned(code);
	};

	return (
		<View style={{ gap: 12 }}>
			<Text style={{ color: C.dim, fontSize: 13 }}>Point the camera at the QR code on your PC.</Text>
			<View style={[styles.wrap, { borderColor: C.line }]}>
				{!Camera ? (
					<Centered color={C.dim}>Camera isn't available in this build — type the code instead.</Centered>
				) : denied ? (
					<Centered color={C.dim}>Camera permission was denied. Allow it in Settings, or type the code.</Centered>
				) : !granted ? (
					<Centered color={C.dim}>Asking for camera permission…</Centered>
				) : (
					<Camera style={{ flex: 1 }} scanBarcode={true} showFrame={false} onReadCode={(e) => handle(e?.nativeEvent?.codeStringValue)} />
				)}
			</View>
			<Pressable onPress={onCancel} style={[styles.cancel, { borderColor: C.fieldLine }]}>
				<Text style={{ color: C.text, fontWeight: "700" }}>Cancel</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { height: 360, borderRadius: 14, overflow: "hidden", borderWidth: 1, backgroundColor: "#000" },
	center: { flex: 1, alignItems: "center", justifyContent: "center" },
	cancel: { borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
});
