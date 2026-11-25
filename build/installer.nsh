; Additions to the installer of electron-builder (tz.md, п. 2.5); electron-builder.yml, nsis.include.

; Only the current user, without administrator rights: the page "all users or only me" is skipped.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The first page: welcome (electron-builder has none by default).
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; After the folder page: the desktop shortcut, ticked. Not shown when updating (the updater installs
; silently; electron-builder then keeps the shortcuts as they are).
!macro customPageAfterChangeDir
  Page custom DesktopShortcutPage DesktopShortcutLeave
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customHeader
    !include nsDialogs.nsh
    Var DesktopCheckbox
    ; "0" — unticked; anything else (also a silent install, without the page) — the shortcut stays.
    Var WantDesktopShortcut

    LangString desktopTitle ${LANG_ENGLISH} "Shortcuts"
    LangString desktopTitle ${LANG_RUSSIAN} "Ярлыки"
    LangString desktopTitle ${LANG_UKRAINIAN} "Ярлики"
    LangString desktopSubtitle ${LANG_ENGLISH} "GeoPhotos is always added to the Start menu."
    LangString desktopSubtitle ${LANG_RUSSIAN} "GeoPhotos всегда добавляется в меню «Пуск»."
    LangString desktopSubtitle ${LANG_UKRAINIAN} "GeoPhotos завжди додається в меню «Пуск»."
    LangString desktopShortcut ${LANG_ENGLISH} "Create a shortcut on the desktop"
    LangString desktopShortcut ${LANG_RUSSIAN} "Создать ярлык на рабочем столе"
    LangString desktopShortcut ${LANG_UKRAINIAN} "Створити ярлик на робочому столі"

    Function DesktopShortcutPage
      ${if} ${isUpdated}
        Abort
      ${endIf}
      !insertmacro MUI_HEADER_TEXT "$(desktopTitle)" "$(desktopSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateCheckbox} 0 0 100% 12u "$(desktopShortcut)"
      Pop $DesktopCheckbox
      ${if} $WantDesktopShortcut != "0"
        ${NSD_Check} $DesktopCheckbox
      ${endIf}
      nsDialogs::Show
    FunctionEnd

    Function DesktopShortcutLeave
      ${NSD_GetState} $DesktopCheckbox $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $WantDesktopShortcut "1"
      ${else}
        StrCpy $WantDesktopShortcut "0"
      ${endIf}
    FunctionEnd
  !macroend

  ; electron-builder creates the desktop shortcut; unticked — it is removed at once.
  !macro customInstall
    ${ifNot} ${isUpdated}
      ${if} $WantDesktopShortcut == "0"
        Delete "$newDesktopLink"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${endIf}
    ${endIf}
  !macroend
!endif

; Uninstalling (not the uninstall that is part of an update): the downloads of the updater go too.
; Settings and logs (%APPDATA%\GeoPhotos) stay (tz.md, п. 2.5).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\geophotos-updater"
  ${endIf}
!macroend
