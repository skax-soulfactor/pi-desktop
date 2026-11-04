; Windows 설치 프로그램의 "실행 중인 앱 닫기" (electron-builder nsis include, 세 앱이 같은 파일을 쓴다).
;
; electron-builder 기본(allowOnlyOneInstallerInstance.nsh)은 실행 파일 경로가 설치 폴더 경로로 "시작하는" 프로세스를
; 모두 이 앱으로 보고 끈다. 그런데 Pi Desktop의 설치 폴더(...\Programs\Pi Desktop)는
; Agent(...\Programs\Pi Desktop Agent)·Mate(...\Programs\Pi Desktop Mate) 폴더의 앞부분과 같아서,
; Pi Desktop을 업데이트하면 Agent·Mate 창까지 꺼졌다.
; 기본 확인을 그대로 쓰되 설치 폴더 끝에 "\"를 붙여, 정확히 이 앱의 폴더 안에서 도는 프로세스만 찾게 한다.
!macro customCheckAppRunning
  Var /GLOBAL PiInstDirBeforeCheck
  StrCpy $PiInstDirBeforeCheck $INSTDIR
  ${If} $INSTDIR != ""
    StrCpy $INSTDIR "$INSTDIR\"
  ${EndIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  StrCpy $INSTDIR $PiInstDirBeforeCheck
!macroend
