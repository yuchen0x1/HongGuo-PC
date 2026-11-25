!ifndef HONGGUO_ACCOUNT_UNINSTALL_INCLUDED
!define HONGGUO_ACCOUNT_UNINSTALL_INCLUDED

!macro customUnInstall
  Var /GLOBAL hgAccountUninstallResult
  # Reinstall and automatic updates must retain the existing account session.
  ${IfNot} ${isUpdated}
    ClearErrors
    # Electron removes only official Cookies and encrypted account files.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-account-data' $hgAccountUninstallResult
    ${If} ${Errors}
      StrCpy $hgAccountUninstallResult "1"
    ${EndIf}
    ${If} $hgAccountUninstallResult != "0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法删除本机红果账号登录数据。请关闭红果短剧后重试卸载。" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!endif
