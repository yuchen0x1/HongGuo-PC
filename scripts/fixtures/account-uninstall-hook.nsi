Unicode true
!include LogicLib.nsh
!include StdUtils.nsh
!include "${FIXTURE_FLAGS}"
!define APP_EXECUTABLE_FILENAME "fixture-helper.exe"
!include "${ACCOUNT_HOOK}"

Name "Account cleanup hook verification"
OutFile "${FIXTURE_EXE}"
RequestExecutionLevel user
SilentInstall silent

Section
  StrCpy $INSTDIR "$EXEDIR"
  ${StdUtils.TestParameter} $R0 "uninstall-account-data"
  ${If} $R0 == "true"
    FileOpen $R1 "$EXEDIR\cleanup-called" w
    FileWrite $R1 "cleanup called"
    FileClose $R1
    ${If} ${FileExists} "$EXEDIR\helper-fails"
      SetErrorLevel 1
    ${Else}
      Delete "$EXEDIR\account-session.bin"
      SetErrorLevel 0
    ${EndIf}
    Quit
  ${EndIf}

  !insertmacro customUnInstall
  FileOpen $R1 "$EXEDIR\uninstall-continued" w
  FileWrite $R1 "uninstall continued"
  FileClose $R1
SectionEnd
