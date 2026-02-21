; Custom NSIS include for CSimple Addon
; Handles closing the tray-only app before install/update

!macro customCheckAppRunning
  ; CSimple Addon is a tray-only Electron app with no main window,
  ; so the default NSIS FindWindow + WM_CLOSE approach cannot find it.
  ; Force-terminate any running instance to allow a clean install/update.

  nsExec::ExecToStack `taskkill /f /im "CSimple Addon.exe"`
  Pop $0  ; exit code (0 = killed, 128 = not running — both are fine)

  ; Give the OS time to release file locks and clean up
  Sleep 2000
!macroend

!macro customUnCheckAppRunning
  ; Same for uninstaller — kill any running instance first
  nsExec::ExecToStack `taskkill /f /im "CSimple Addon.exe"`
  Pop $0
  Sleep 2000
!macroend
