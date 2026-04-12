#ifndef MyAppName
  #define MyAppName "pp"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#ifndef MyAppPublisher
  #define MyAppPublisher "pp"
#endif
#ifndef MyAppExeName
  #define MyAppExeName "pp.exe"
#endif
#ifndef MyUiExeName
  #define MyUiExeName "pp-ui.exe"
#endif

[Setup]
AppId={{E2F0D940-8E80-46B1-91D6-547D097E8DE3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\pp
DefaultGroupName=pp
DisableProgramGroupPage=yes
SetupIconFile=assets\pp-icon.ico
UninstallDisplayIcon={app}\pp-icon.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes
Compression=lzma
SolidCompression=yes
WizardStyle=modern
OutputDir=..\..\release\installer
OutputBaseFilename=pp-setup

[Tasks]
Name: "addtopath"; Description: "Add pp to PATH"; GroupDescription: "Additional tasks:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a desktop shortcut for PP UI"; GroupDescription: "Additional tasks:"; Flags: unchecked

[Files]
Source: "..\..\release\win32-x64\pp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\release\win32-x64\pp-mcp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\release\win32-x64\pp-ui.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "assets\pp-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\PP UI"; Filename: "{app}\{#MyUiExeName}"; IconFilename: "{app}\pp-icon.ico"
Name: "{autodesktop}\PP UI"; Filename: "{app}\{#MyUiExeName}"; IconFilename: "{app}\pp-icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyUiExeName}"; Description: "Launch PP UI"; Flags: nowait postinstall skipifsilent

[Code]
procedure EnvAddPath(Path: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', Paths) then
    Paths := '';
  if Pos(';' + Uppercase(Path) + ';', ';' + Uppercase(Paths) + ';') = 0 then begin
    if (Paths <> '') and (Copy(Paths, Length(Paths), 1) <> ';') then
      Paths := Paths + ';';
    Paths := Paths + Path;
    RegWriteStringValue(HKCU, 'Environment', 'Path', Paths);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('addtopath') then
    EnvAddPath(ExpandConstant('{app}'));
end;
