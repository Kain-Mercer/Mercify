import "./src/polyfills"; // first: Buffer, getRandomValues, process for overlay/lobby.js
import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
