; Mercify: extra uninstall step (electron-builder includes build/installer.nsh automatically).
;
; Uninstalling Mercify asks whether to remove the Spotify add-ons its setup put in place:
;   Yes: Mercify.exe --uninstall-cleanup            (Spicetify undone and deleted, SpotX's backups
;                                                     put back; Spotify stays installed)
;   No:  Mercify.exe --uninstall-cleanup=extension  (only Mercify's own extension comes out, for
;                                                     people who had Spicetify/SpotX before Mercify)
; Never when the uninstaller runs as part of an update (isUpdated) or silently (/S): an update
; must leave Spotify exactly as it is.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Also remove the Spotify add-ons that Mercify set up (Spicetify and SpotX)?$\r$\n$\r$\nSpotify itself stays installed and goes back to normal.$\r$\n$\r$\nChoose No if you used Spicetify or SpotX before Mercify and want to keep them. Only Mercify's own part is removed then." /SD IDNO IDYES mercifyRemoveAll
      DetailPrint "Removing Mercify from Spotify..."
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup=extension'
      Goto mercifyCleanupDone
      mercifyRemoveAll:
      DetailPrint "Removing Spicetify and SpotX..."
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup'
      mercifyCleanupDone:
    ${endIf}
  ${endIf}
!macroend
