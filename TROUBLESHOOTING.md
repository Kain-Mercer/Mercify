# Troubleshooting

First thing to try for almost anything: make sure Mercify is up to date. It updates itself when you open it.

**I can't see the panels in my game.**
Set your game to **Windowed (Fullscreen)** or **Borderless**, not Fullscreen. Check the game is listed under **Only show over these apps** in Settings (see [other games](USING.md#using-it-with-other-games)). And press `Ctrl` + `` ` ``, in case they're just hidden.

**The panels say "Waiting for Spotify".**
Click the message to open Settings. If anything there isn't green, press the big button. If everything is green, make sure Spotify is open; if it is, press **Redo** next to *Mercify extension*. This is most often needed after Spotify updates itself.

**Windows says "Windows protected your PC".**
Click **More info**, then **Run anyway**. Windows shows this for new programs it doesn't know yet.

**The overlay disappears after I click it, or my game stops taking keys.**
Right after it happens, right-click the Mercify tray icon, choose **Copy diagnostics**, and paste it into an [issue](https://github.com/Kain-Mercer/Mercify/issues) or a message. It lists which windows Windows put in front and what Mercify did, without any of your other window titles.

**Clicking an album does nothing, or says it couldn't open it.**
Albums open in the **Playlist** panel, so make sure that panel is turned on in Edit Mode. Opening albums also needs the newer Mercify extension: open Settings and press **Finish setup** if it's offered (Spotify restarts once).

**I can't join a lobby ("Couldn't reach any lobby relay").**
A firewall, or a school or work network, may be blocking the lobby relays. They use ports 8084, 8884 and 8081. Try another network, such as your phone's hotspot, to check.

**The panels have a black box behind them.**
Some graphics drivers cause this. [Open an issue](https://github.com/Kain-Mercer/Mercify/issues) and we'll help you switch on a fix.

**A shortcut doesn't work.**
Another program may already be using it. Mercify tells you when it starts if a shortcut couldn't be set up.

**Something else is wrong?**
Please [open an issue](https://github.com/Kain-Mercer/Mercify/issues) and describe what happened. A screenshot helps a lot.
