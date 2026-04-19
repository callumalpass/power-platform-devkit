#ifndef MyAppName
  #define MyAppName "PP"
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
  #define MyUiExeName "PP Desktop.exe"
#endif

[Setup]
AppId={{E2F0D940-8E80-46B1-91D6-547D097E8DE3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PP
DefaultGroupName=PP
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
Name: "addtopath"; Description: "Add pp command-line tools to PATH"; GroupDescription: "Additional tasks:"; Flags: unchecked; Components: cli
Name: "desktopicon"; Description: "Create a desktop shortcut for PP Desktop"; GroupDescription: "Additional tasks:"; Flags: unchecked; Components: desktop

[Types]
Name: "full"; Description: "Desktop, MCP server, and command-line tools"
Name: "desktop"; Description: "Desktop app only"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "desktop"; Description: "PP Desktop"; Types: full desktop custom; Flags: fixed
Name: "mcp"; Description: "MCP server for AI clients"; Types: full custom
Name: "cli"; Description: "Command-line tools"; Types: full custom

[Files]
Source: "..\..\release\electron\win-unpacked\*"; DestDir: "{app}\desktop"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: desktop
Source: "..\..\release\win32-x64\pp.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: cli
Source: "..\..\release\win32-x64\pp-mcp.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: mcp
Source: "assets\pp-icon.ico"; DestDir: "{app}"; Flags: ignoreversion; Components: desktop

[Icons]
Name: "{autoprograms}\PP Desktop"; Filename: "{app}\desktop\{#MyUiExeName}"; IconFilename: "{app}\pp-icon.ico"; Components: desktop
Name: "{autodesktop}\PP Desktop"; Filename: "{app}\desktop\{#MyUiExeName}"; IconFilename: "{app}\pp-icon.ico"; Tasks: desktopicon; Components: desktop

[Run]
Filename: "{app}\desktop\{#MyUiExeName}"; Description: "Launch PP Desktop"; Flags: nowait postinstall skipifsilent; Components: desktop

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
