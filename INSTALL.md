# Installing and removing Mercify

## What you need

- **Windows 10 or 11.**
- **The Spotify desktop app.** If you don't have it, Mercify installs it for you. The Microsoft Store version won't work.
- **Your game set to "Windowed (Fullscreen)" or "Borderless"** in its graphics settings. Mercify can't appear over true fullscreen.

A free Spotify account is fine.

## Install

1. Go to the [Releases page](https://github.com/Kain-Mercer/Mercify/releases/latest) and download **`Mercify-Setup`**.
2. Run it. If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**. That appears because Mercify is new and Windows doesn't know it yet.
3. Mercify opens its **Settings** window. Press the big green **Set up everything** button.
   It installs Spotify if you don't have it, plus the two add-ons Mercify needs to talk to Spotify (SpotX and Spicetify). It doesn't ask you anything. It takes a few minutes, and the bar at the top shows how far along it is, so you can do something else meanwhile.
4. At the end Spotify opens. **Log in** if it asks, and the last row, **Connected to Spotify**, turns green by itself.
   - Spotify not showing? Press **Open Spotify** on that row.
   - Spotify's window blank after you log in? That can happen the first time. Mercify notices and restarts Spotify for you a few seconds later.
5. Start your game. Your Spotify panels appear on top of it.

If something goes wrong, Settings says what in plain words, with a **Try again** button. **Copy details** copies everything that happened, to paste into a message or an [issue](https://github.com/Kain-Mercer/Mercify/issues).

Mercify doesn't install Spicetify's Marketplace (it isn't needed), so you won't see a Marketplace button in Spotify.

## Every time you open it

Mercify checks for an update first (see [Updates](UPDATES.md)), then opens Spotify if it isn't running and tucks Spotify's own window into the tray, since Mercify's panels do its job. To bring Spotify's window back, right-click the Mercify tray icon and choose **Show Spotify window**.

## The portable version

Prefer not to install anything? Download **`Mercify-portable`** instead. It runs straight from the file, but starts a little slower and can't update itself: Settings tells you when there's a new version and gives you a **Download** button.

## Uninstalling

Uninstall Mercify from Windows' **Apps** settings like any other program. It asks whether to also remove the Spotify add-ons it set up:

- **Yes** puts Spotify back to normal. Spotify itself stays installed.
- **No** removes only Mercify's own part and leaves SpotX and Spicetify as they are. Choose this if you used them before Mercify.

Using the portable version? Open Settings and click **Remove Spicetify and SpotX…** under Setup before deleting the file.
