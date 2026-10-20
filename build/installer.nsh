# A directory update must not uninstall or re-register a copy in another folder.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !ifdef APP_32
      !include "${BUILD_RESOURCES_DIR}\update-files-ia32.nsh"
    !endif
    !ifdef APP_64
      !include "${BUILD_RESOURCES_DIR}\update-files-x64.nsh"
    !endif
    !ifdef APP_ARM64
      !include "${BUILD_RESOURCES_DIR}\update-files-arm64.nsh"
    !endif
    Function piUpdateDirectory
      InitPluginsDir
      StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${ifNot} ${FileExists} "$appExe"
        MessageBox MB_OK|MB_ICONSTOP "当前目录中没有 Pi Desktop，已取消更新：$\r$\n$INSTDIR" /SD IDOK
        SetErrorLevel 1
        Quit
      ${endif}

      StrCpy $R3 ""
      ClearErrors
      !ifdef COMPRESS
        SetCompress off
      !endif
      !ifdef APP_32
        File /oname=$PLUGINSDIR\pi-directory-32.${COMPRESSION_METHOD} "${APP_32}"
        StrCpy $R3 "$PLUGINSDIR\pi-directory-32.${COMPRESSION_METHOD}"
        StrCpy $R6 "ia32"
      !endif
      !ifdef APP_64
        ${if} ${RunningX64}
        ${orIf} ${IsNativeARM64}
          File /oname=$PLUGINSDIR\pi-directory-64.${COMPRESSION_METHOD} "${APP_64}"
          StrCpy $R3 "$PLUGINSDIR\pi-directory-64.${COMPRESSION_METHOD}"
          StrCpy $R6 "x64"
        ${endif}
      !endif
      !ifdef APP_ARM64
        ${if} ${IsNativeARM64}
          File /oname=$PLUGINSDIR\pi-directory-arm64.${COMPRESSION_METHOD} "${APP_ARM64}"
          StrCpy $R3 "$PLUGINSDIR\pi-directory-arm64.${COMPRESSION_METHOD}"
          StrCpy $R6 "arm64"
        ${endif}
      !endif
      !ifdef COMPRESS
        SetCompress "${COMPRESS}"
      !endif

      IfErrors piDirectoryExtractFailed
      SetOutPath "$PLUGINSDIR\pi-directory-files"
      IfErrors piDirectoryExtractFailed
      !ifdef ZIP_COMPRESSION
        nsisunz::Unzip "$R3" "$OUTDIR"
        Pop $R0
        StrCmp $R0 "success" 0 piDirectoryExtractFailed
      !else
        Nsis7z::Extract "$R3"
      !endif
      # Verify every extracted file before copying.
      ${if} $R6 == "ia32"
        !ifdef APP_32
          !insertmacro piVerifyDirectory_ia32 "$OUTDIR"
        !endif
      ${elseif} $R6 == "x64"
        !ifdef APP_64
          !insertmacro piVerifyDirectory_x64 "$OUTDIR"
        !endif
      ${elseif} $R6 == "arm64"
        !ifdef APP_ARM64
          !insertmacro piVerifyDirectory_arm64 "$OUTDIR"
        !endif
      ${else}
        Goto piDirectoryExtractFailed
      ${endif}

      SetOutPath "$INSTDIR"
      StrCpy $R4 0
      piDirectoryCopy:
        ClearErrors
        CopyFiles /SILENT "$PLUGINSDIR\pi-directory-files\*" "$INSTDIR"
        IfErrors 0 piDirectoryUpdated
        IntOp $R4 $R4 + 1
        ${if} $R4 < 5
          Sleep 1000
          Goto piDirectoryCopy
        ${endif}
        MessageBox MB_OK|MB_ICONSTOP "无法写入更新文件。请关闭当前目录的 Pi Desktop，并检查磁盘空间和目录写入权限后重试：$\r$\n$INSTDIR" /SD IDOK
        SetErrorLevel 1
        Quit

      piDirectoryExtractFailed:
        MessageBox MB_OK|MB_ICONSTOP "无法解压更新文件，请重新下载更新。" /SD IDOK
        SetErrorLevel 1
        Quit

      piDirectoryUpdated:
        ${if} ${isForceRun}
          ${StdUtils.ExecShellAsUser} $0 "$appExe" "open" "--updated"
        ${endif}
    FunctionEnd
  !endif
!macroend

!macro customInit
  # Node quotes a /D argument containing spaces; the upstream parser retains its
  # final quote. Quotes cannot be part of a Windows directory name.
  StrCpy $R0 $INSTDIR 1 -1
  ${if} $R0 == '$\"'
    StrCpy $INSTDIR $INSTDIR -1
  ${endif}
  ${if} ${isUpdated}
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $R0 != $INSTDIR
      Call piUpdateDirectory
      !insertmacro quitSuccess
    ${endif}
  ${endif}
!macroend

# A retained shortcut can point to an older unpacked build. Normal installations
# also restart their own executable and repair shortcuts that still exist.
!macro customInstall
  StrCpy $launchLink "$appExe"

  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endif}
  !endif

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${if} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endif}
  !endif
!macroend
