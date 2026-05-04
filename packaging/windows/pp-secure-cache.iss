#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#ifndef MyAppPublisher
  #define MyAppPublisher "pp"
#endif
#ifndef MySecureCacheExeName
  #define MySecureCacheExeName "pp-secure-cache.exe"
#endif

[Setup]
AppId={{6A71F902-5D18-4F69-B4DD-C130AF88C14E}
AppName=PP Secure Cache Add-on
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PP
DisableProgramGroupPage=yes
SetupIconFile=assets\pp-icon.ico
UninstallDisplayIcon={app}\secure-cache\{#MySecureCacheExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma
SolidCompression=yes
WizardStyle=modern
OutputDir=..\..\release\installer
OutputBaseFilename=pp-secure-cache-addon

[Files]
Source: "..\..\release\win32-x64\pp-secure-cache.exe"; DestDir: "{app}\secure-cache"; Flags: ignoreversion
