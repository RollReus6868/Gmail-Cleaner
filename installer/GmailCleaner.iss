; Inno Setup - cai theo tung nguoi dung, khong can quyen admin.
; Build:  ISCC.exe /DAppVersion=1.0.0 installer\GmailCleaner.iss
; Can co san ket qua PyInstaller o dist\GmailCleaner
#ifndef AppVersion
  #error "Pass /DAppVersion=x.y.z to ISCC"
#endif

[Setup]
AppId={{A3959C4A-200D-4194-BE28-B80DAEA6A5DE}
AppName=Gmail Cleaner
AppVersion={#AppVersion}
AppVerName=Gmail Cleaner {#AppVersion}
AppPublisher=Gmail Cleaner
DefaultDirName={localappdata}\Programs\Gmail Cleaner
DefaultGroupName=Gmail Cleaner
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=GmailCleaner-{#AppVersion}-windows-setup
UninstallDisplayIcon={app}\GmailCleaner.exe
UninstallDisplayName=Gmail Cleaner
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Gmail Cleaner

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
; xoa thu vien cua ban cu de khong lan voi ban moi
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\GmailCleaner\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Gmail Cleaner"; Filename: "{app}\GmailCleaner.exe"
Name: "{autodesktop}\Gmail Cleaner"; Filename: "{app}\GmailCleaner.exe"; Tasks: desktopicon

[Run]
; cai tay: hoi co mo app khong.  tu cap nhat (chay im lang): tu mo lai app.
Filename: "{app}\GmailCleaner.exe"; Description: "Launch Gmail Cleaner"; Flags: nowait postinstall skipifsilent
Filename: "{app}\GmailCleaner.exe"; Flags: nowait; Check: RelaunchAfterUpdate

[Code]
// Tu cap nhat: app goi bo cai (im lang) roi moi thoat. App giu mutex
// "GmailCleanerRunning" suot luc chay, nen cho mutex bien mat (toi da 60 giay)
// roi moi ghi de file.
function InitializeSetup(): Boolean;
var
  I: Integer;
begin
  if WizardSilent then
  begin
    I := 0;
    while CheckForMutexes('GmailCleanerRunning') and (I < 120) do
    begin
      Sleep(500);
      I := I + 1;
    end;
  end;
  Result := True;
end;

// GC_UPDATE_NO_RELAUNCH=1: dung khi kiem thu tren CI de khong mo lai app.
function RelaunchAfterUpdate(): Boolean;
begin
  Result := WizardSilent and (GetEnv('GC_UPDATE_NO_RELAUNCH') = '');
end;
