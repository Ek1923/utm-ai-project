import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';

interface ExecuteBody {
  action: string;
  param:  string;
}

const SAFE_APP_NAMES = /^[\w\-\.\s]{1,80}$/;
const SAFE_PATH      = /^[A-Za-z]:[\\\/][\w\s\-\.\\/()]{1,260}$/;
const SAFE_URL       = /^https?:\/\/.{4,500}$/;

// Known apps that launch via a protocol/shell command instead of a plain exe name.
// Lets "open WhatsApp" actually open the Microsoft Store app.
const APP_LAUNCH: Record<string, string> = {
  whatsapp:   'whatsapp:',
  telegram:   'tg:',
  spotify:    'spotify:',
  discord:    'discord:',
  settings:   'ms-settings:',
  store:      'ms-windows-store:',
  mail:       'outlookmail:',
  calendar:   'outlookcal:',
  maps:       'bingmaps:',
  photos:     'ms-photos:',
};

// Translate Windows SendKeys metacharacters and strip newlines so a typed
// message never submits itself mid-way.
function toSendKeys(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/([+^%~(){}\[\]])/g, '{$1}');
}

// Virtual-key codes for hotkeys via keybd_event (supports the Windows key,
// which SendKeys cannot send).
const VK: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5B, meta: 0x5B, cmd: 0x5B,
  enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20,
  backspace: 0x08, back: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  printscreen: 0x2C, capslock: 0x14,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
};
function vkFor(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (VK[t] !== undefined) return VK[t];
  if (/^[a-z]$/.test(t)) return t.toUpperCase().charCodeAt(0);   // a-z → 0x41-0x5A
  if (/^[0-9]$/.test(t)) return t.charCodeAt(0);                 // 0-9 → 0x30-0x39
  return null;
}

// Build a PowerShell snippet that presses a key combo like "ctrl+shift+esc"
// using keybd_event (down modifiers → down key → up key → up modifiers).
function buildHotkey(combo: string): string | null {
  const tokens = combo.split('+').map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;
  const codes = tokens.map(vkFor);
  if (codes.some(c => c === null)) return null;
  const vks = codes as number[];
  const downs = vks.map(c => `[W.K]::keybd_event(${c},0,0,[UIntPtr]::Zero)`).join('; ');
  const ups   = [...vks].reverse().map(c => `[W.K]::keybd_event(${c},0,2,[UIntPtr]::Zero)`).join('; ');
  return (
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);' -Name K -Namespace W -ErrorAction SilentlyContinue; ` +
    `${downs}; Start-Sleep -Milliseconds 30; ${ups}`
  );
}

// Build a PowerShell snippet that moves the cursor and clicks (left/right/double).
function buildClick(x: number, y: number, button: 'left' | 'right' | 'double'): string {
  const move = `[W.M]::SetCursorPos(${x},${y});`;
  const L = `[W.M]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [W.M]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)`;
  const R = `[W.M]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [W.M]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero)`;
  const click = button === 'right' ? R : button === 'double' ? `${L}; Start-Sleep -Milliseconds 80; ${L}` : L;
  return (
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);' -Name M -Namespace W -ErrorAction SilentlyContinue; ` +
    `${move} Start-Sleep -Milliseconds 60; ${click}`
  );
}

function ps(command: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
    });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', code => resolve({ ok: code === 0, output: out.trim() }));
    proc.on('error', e  => resolve({ ok: false, output: e.message }));
  });
}

export async function systemControlRoutes(fastify: FastifyInstance) {

  fastify.post<{ Body: ExecuteBody }>('/api/system/execute', async (req, reply) => {
    const { action, param } = req.body ?? {};
    if (!action) return reply.code(400).send({ ok: false, message: 'Geen actie opgegeven' });

    let result: { ok: boolean; output: string };

    switch (action) {

      case 'open_app': {
        if (!SAFE_APP_NAMES.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige app naam' });
        const key    = param.trim().toLowerCase();
        const home   = process.env.USERPROFILE ?? 'C:\\Users\\Default';
        // Terminals always open in the user's home dir, as the current user
        if (key === 'powershell' || key === 'powershell.exe') {
          result = await ps(`Start-Process "powershell.exe" -WorkingDirectory "${home}"`);
        } else if (key === 'cmd' || key === 'cmd.exe') {
          result = await ps(`Start-Process "cmd.exe" -WorkingDirectory "${home}"`);
        } else if (key === 'wt' || key === 'windowsterminal' || key === 'terminal') {
          result = await ps(`Start-Process "wt.exe" -WorkingDirectory "${home}"`);
        } else {
          const target = APP_LAUNCH[key] ?? param.replace(/"/g, '');
          result = await ps(`Start-Process "${target}"`);
        }
        break;
      }

      case 'focus_app': {
        // Bring an app window to the foreground by process name or window title
        if (!SAFE_APP_NAMES.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige naam' });
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);' -Name U -Namespace W -ErrorAction SilentlyContinue; ` +
          `$p = Get-Process "${param.replace(/"/g,'')}" -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
          `if ($p -and $p.MainWindowHandle -ne 0) { [W.U]::ShowWindow($p.MainWindowHandle, 9); [W.U]::SetForegroundWindow($p.MainWindowHandle); Write-Host "Gefocust: $($p.Name)" } else { Write-Host "Venster niet gevonden" }`
        );
        break;
      }

      case 'scroll': {
        // Scroll at current mouse position. param: "up" | "down" | number (positive=up, negative=down)
        const dir   = (param ?? 'down').trim().toLowerCase();
        const delta = dir === 'up' ? 3 : dir === 'down' ? -3 : parseInt(param) || -3;
        const wheel = delta * 120;
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);' -Name M -Namespace W -ErrorAction SilentlyContinue; ` +
          `[W.M]::mouse_event(0x0800, 0, 0, ${wheel}, [UIntPtr]::Zero)`
        );
        if (result.ok) result.output = `Gescrold (${dir})`;
        break;
      }

      case 'read_clipboard': {
        result = await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()`);
        break;
      }

      case 'write_clipboard': {
        if (!param || param.length > 5000) return reply.code(400).send({ ok: false, message: 'Tekst te lang' });
        const safe = param.replace(/'/g, "''");
        result = await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText('${safe}')`);
        if (result.ok) result.output = 'Klembord bijgewerkt';
        break;
      }

      case 'list_processes': {
        result = await ps(`Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name,Id,@{n='CPU';e={[math]::Round($_.CPU,1)}},@{n='RAM_MB';e={[math]::Round($_.WorkingSet/1MB,0)}} | ConvertTo-Json`);
        break;
      }

      case 'kill_process': {
        if (!SAFE_APP_NAMES.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige naam/PID' });
        const isNum = /^\d+$/.test(param.trim());
        result = await ps(isNum
          ? `Stop-Process -Id ${param.trim()} -Force -ErrorAction Stop`
          : `Stop-Process -Name "${param.replace(/"/g,'')}" -Force -ErrorAction Stop`
        );
        if (result.ok) result.output = `${param} gestopt`;
        break;
      }

      case 'get_window': {
        // Get title of currently focused window
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);' -Name U -Namespace W -ErrorAction SilentlyContinue; ` +
          `$h = [W.U]::GetForegroundWindow(); $s = New-Object System.Text.StringBuilder 256; [W.U]::GetWindowText($h, $s, 256) | Out-Null; Write-Host $s.ToString()`
        );
        break;
      }

      case 'type_text': {
        if (!param || param.length > 2000) return reply.code(400).send({ ok: false, message: 'Ongeldige tekst (max 2000 tekens)' });
        const sk = toSendKeys(param).replace(/'/g, "''");
        // Wait 1.5 s so newly opened apps (PowerShell, notepad, etc.) are fully focused
        result = await ps(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `Start-Sleep -Milliseconds 1500; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('${sk}')`
        );
        if (result.ok) result.output = 'Tekst getypt';
        break;
      }

      case 'send_enter': {
        // Press Enter in the focused window — used to actually send the typed message.
        result = await ps(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`
        );
        if (result.ok) result.output = 'Verzonden';
        break;
      }

      case 'hotkey': {
        // Press any key combination in the focused window, e.g. "ctrl+c",
        // "alt+tab", "win+e", "ctrl+shift+esc", "enter", "f5".
        const cmd = buildHotkey(param ?? '');
        if (!cmd) return reply.code(400).send({ ok: false, message: `Ongeldige toetsencombinatie: ${param}` });
        result = await ps(cmd);
        if (result.ok) result.output = `Toetsen: ${param}`;
        break;
      }

      case 'click': {
        // Move mouse + click. param: "x,y" or "x,y,right" / "x,y,double".
        const parts = (param ?? '').split(',').map(s => s.trim());
        const x = parseInt(parts[0], 10);
        const y = parseInt(parts[1], 10);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return reply.code(400).send({ ok: false, message: 'Formaat: x,y[,right|double]' });
        const btn = (parts[2] === 'right' || parts[2] === 'double') ? parts[2] : 'left';
        result = await ps(buildClick(x, y, btn as 'left' | 'right' | 'double'));
        if (result.ok) result.output = `${btn}-klik op ${x},${y}`;
        break;
      }

      case 'run_command': {
        // Arbitrary PowerShell — Jarvis operating the PC as a second user with
        // the user's permissions. Always shown to the user for approval first.
        if (!param || param.length > 4000) return reply.code(400).send({ ok: false, message: 'Ongeldig commando' });
        result = await ps(param);
        result.output = (result.output || '(geen uitvoer)').slice(0, 4000);
        break;
      }

      case 'open_folder': {
        const p = param || (process.env.USERPROFILE ?? 'C:\\');
        result = await ps(`Start-Process explorer.exe -ArgumentList "${p.replace(/"/g, '')}"`);
        break;
      }

      case 'open_file': {
        if (!SAFE_PATH.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(`Start-Process "${param.replace(/"/g, '')}"`);
        break;
      }

      case 'open_url': {
        if (!SAFE_URL.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige URL' });
        result = await ps(`Start-Process "${param}"`);
        break;
      }

      case 'create_folder': {
        if (!SAFE_PATH.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(`New-Item -ItemType Directory -Force -Path "${param.replace(/"/g, '')}"`);
        break;
      }

      case 'write_file': {
        // param format: "path|content"
        const sep = param.indexOf('|');
        if (sep < 0) return reply.code(400).send({ ok: false, message: 'Formaat: pad|inhoud' });
        const filePath = param.slice(0, sep);
        const content  = param.slice(sep + 1).replace(/'/g, "''");
        if (!SAFE_PATH.test(filePath)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(`Set-Content -Path "${filePath.replace(/"/g, '')}" -Value '${content}' -Encoding UTF8`);
        break;
      }

      case 'take_screenshot': {
        const dest = (process.env.USERPROFILE ?? 'C:\\Users\\Default') + `\\Desktop\\nexus-screenshot-${Date.now()}.png`;
        result = await ps(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `Add-Type -AssemblyName System.Drawing; ` +
          `$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
          `$bmp=New-Object System.Drawing.Bitmap $s.Width,$s.Height; ` +
          `$g=[System.Drawing.Graphics]::FromImage($bmp); ` +
          `$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size); ` +
          `$bmp.Save('${dest}'); Write-Host 'Opgeslagen: ${dest}'`
        );
        if (result.ok) result.output = `Screenshot opgeslagen: ${dest}`;
        break;
      }

      case 'close_app': {
        if (!SAFE_APP_NAMES.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige app naam' });
        const name = param.replace(/\.[Ee][Xx][Ee]$/, '').replace(/"/g, '');
        result = await ps(`Stop-Process -Name "${name}" -Force -ErrorAction SilentlyContinue`);
        result.ok = true;
        result.output = `${param} gestopt`;
        break;
      }

      case 'adjust_volume': {
        const vol = Math.min(100, Math.max(0, parseInt(param) || 50));
        result = await ps(
          `$obj = New-Object -ComObject WScript.Shell; ` +
          `$cur = (Get-WmiObject -Class Win32_SoundDevice).StatusInfo; ` +
          `Add-Type -MemberDefinition '[DllImport(\"winmm.dll\")] public static extern int waveOutSetVolume(IntPtr h, uint v);' -Name WM -Namespace Audio -ErrorAction SilentlyContinue; ` +
          `$v = [uint32]([math]::Round(${vol} / 100.0 * 65535)); ` +
          `[Audio.WM]::waveOutSetVolume([IntPtr]::Zero, ($v -bor ($v -shl 16))); ` +
          `Write-Host "Volume: ${vol}%"`
        );
        result.ok = true;
        result.output = `Volume ingesteld op ${vol}%`;
        break;
      }

      case 'get_volume': {
        result = await ps(
          `(Get-AudioDevice -Playback).Volume 2>$null; if (!$?) { ` +
          `$code = '[DllImport(\"winmm.dll\")] public static extern int waveOutGetVolume(IntPtr h, ref uint v);'; ` +
          `Add-Type -MemberDefinition $code -Name WM -Namespace Audio -ErrorAction SilentlyContinue; ` +
          `$v = [uint32]0; [Audio.WM]::waveOutGetVolume([IntPtr]::Zero, [ref]$v) | Out-Null; ` +
          `$pct = [math]::Round(($v -band 0xFFFF) / 65535 * 100); Write-Host "$pct%" }`
        );
        break;
      }

      case 'mute': {
        // Toggle mute via keyboard shortcut
        result = await ps(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.SendKeys]::SendWait([char]173)`
        );
        if (result.ok) result.output = 'Mute getoggeld';
        break;
      }

      case 'speak': {
        // Text-to-speech
        if (!param || param.length > 1000) return reply.code(400).send({ ok: false, message: 'Tekst te lang' });
        const safe = param.replace(/'/g, "''");
        result = await ps(
          `Add-Type -AssemblyName System.Speech; ` +
          `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
          `$s.Rate = 1; $s.Volume = 90; ` +
          `$s.Speak('${safe}')`
        );
        if (result.ok) result.output = `Gesproken: "${param.slice(0, 60)}..."`;
        break;
      }

      case 'notify': {
        // Windows toast/popup notification
        if (!param || param.length > 500) return reply.code(400).send({ ok: false, message: 'Tekst te lang' });
        const safe = param.replace(/"/g, '').replace(/'/g, "''");
        result = await ps(
          `$sh = New-Object -ComObject WScript.Shell; ` +
          `$sh.Popup('${safe}', 4, 'NEXUS', 64)`
        );
        if (result.ok) result.output = 'Notificatie verstuurd';
        break;
      }

      case 'maximize_window': {
        const target = param?.trim();
        if (target) {
          result = await ps(
            `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c,string t);' -Name U -Namespace W -ErrorAction SilentlyContinue; ` +
            `$p=Get-Process "${target.replace(/"/g,'')}" -EA SilentlyContinue|Select -First 1; ` +
            `if($p){[W.U]::ShowWindow($p.MainWindowHandle,3)|Out-Null; Write-Host "Gemaximaliseerd"} else {Write-Host "Niet gevonden"}`
          );
        } else {
          result = await ps(
            `Add-Type -AssemblyName System.Windows.Forms; ` +
            `[System.Windows.Forms.SendKeys]::SendWait('%{UP}')`
          );
          if (result.ok) result.output = 'Venster gemaximaliseerd';
        }
        break;
      }

      case 'minimize_window': {
        const target = param?.trim();
        if (target) {
          result = await ps(
            `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);' -Name U -Namespace W -ErrorAction SilentlyContinue; ` +
            `$p=Get-Process "${target.replace(/"/g,'')}" -EA SilentlyContinue|Select -First 1; ` +
            `if($p){[W.U]::ShowWindow($p.MainWindowHandle,6)|Out-Null; Write-Host "Geminimaliseerd"}`
          );
        } else {
          result = await ps(`(New-Object -ComObject Shell.Application).MinimizeAll()`);
          if (result.ok) result.output = 'Alle vensters geminimaliseerd';
        }
        break;
      }

      case 'read_file': {
        if (!SAFE_PATH.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(`Get-Content "${param.replace(/"/g,'')}" -Raw -ErrorAction Stop`);
        result.output = (result.output || '').slice(0, 8000);
        break;
      }

      case 'delete_file': {
        if (!SAFE_PATH.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(`Remove-Item "${param.replace(/"/g,'')}" -Force -ErrorAction Stop`);
        if (result.ok) result.output = `Verwijderd: ${param}`;
        break;
      }

      case 'copy_file': {
        // param: "source|destination"
        const [src, dst] = param.split('|').map(s => s.trim());
        if (!src || !dst) return reply.code(400).send({ ok: false, message: 'Formaat: bron|doel' });
        result = await ps(`Copy-Item "${src.replace(/"/g,'')}" -Destination "${dst.replace(/"/g,'')}" -Force`);
        if (result.ok) result.output = `Gekopieerd naar ${dst}`;
        break;
      }

      case 'move_file': {
        const [src2, dst2] = param.split('|').map(s => s.trim());
        if (!src2 || !dst2) return reply.code(400).send({ ok: false, message: 'Formaat: bron|doel' });
        result = await ps(`Move-Item "${src2.replace(/"/g,'')}" -Destination "${dst2.replace(/"/g,'')}" -Force`);
        if (result.ok) result.output = `Verplaatst naar ${dst2}`;
        break;
      }

      case 'list_folder': {
        const folder = param?.trim() || (process.env.USERPROFILE ?? 'C:\\');
        result = await ps(`Get-ChildItem "${folder.replace(/"/g,'')}" | Select-Object Name,@{n='Type';e={if($_.PSIsContainer){'map'}else{'bestand'}}},@{n='Size';e={if($_.PSIsContainer){''}else{"$([math]::Round($_.Length/1KB,1)) KB"}}},LastWriteTime | ConvertTo-Json`);
        result.output = (result.output || '').slice(0, 6000);
        break;
      }

      case 'search_files': {
        // param: "folder|pattern" e.g. "C:\\Users|*.txt"
        const [sfolder, spattern] = (param ?? '').split('|').map(s => s.trim());
        if (!sfolder || !spattern) return reply.code(400).send({ ok: false, message: 'Formaat: map|patroon' });
        result = await ps(`Get-ChildItem "${sfolder.replace(/"/g,'')}" -Recurse -Filter "${spattern.replace(/"/g,'')}" -ErrorAction SilentlyContinue | Select-Object -First 30 FullName,@{n='Size_KB';e={[math]::Round($_.Length/1KB,1)}} | ConvertTo-Json`);
        result.output = (result.output || '(niets gevonden)').slice(0, 4000);
        break;
      }

      case 'get_system_info': {
        result = await ps(
          `$cpu = Get-WmiObject Win32_Processor | Select -First 1; ` +
          `$os  = Get-WmiObject Win32_OperatingSystem; ` +
          `$ram_total = [math]::Round($os.TotalVisibleMemorySize/1MB,1); ` +
          `$ram_free  = [math]::Round($os.FreePhysicalMemory/1MB,1); ` +
          `$ram_used  = [math]::Round($ram_total - $ram_free,1); ` +
          `$disk = Get-PSDrive C | Select-Object @{n='Used_GB';e={[math]::Round($_.Used/1GB,1)}},@{n='Free_GB';e={[math]::Round($_.Free/1GB,1)}}; ` +
          `$cpuload = (Get-WmiObject Win32_Processor).LoadPercentage; ` +
          `Write-Host "CPU: $($cpu.Name.Trim()) | Load: $cpuload%"; ` +
          `Write-Host "RAM: $ram_used GB gebruikt / $ram_total GB totaal ($ram_free GB vrij)"; ` +
          `Write-Host "Schijf C: $($disk.Used_GB) GB gebruikt / $([math]::Round($disk.Used_GB+$disk.Free_GB,1)) GB totaal ($($disk.Free_GB) GB vrij)"; ` +
          `Write-Host "OS: $($os.Caption) — uptime: $([math]::Round(($os.LocalDateTime - $os.LastBootUpTime).TotalHours,1)) uur"`
        );
        break;
      }

      case 'get_network_info': {
        result = await ps(
          `$adapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1'} | Select-Object InterfaceAlias,IPAddress,PrefixLength; ` +
          `foreach($a in $adapters){ Write-Host "$($a.InterfaceAlias): $($a.IPAddress)/$($a.PrefixLength)" }; ` +
          `$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select -First 1).NextHop; ` +
          `Write-Host "Gateway: $gw"; ` +
          `$dns = (Get-DnsClientServerAddress -AddressFamily IPv4 | Select -First 1).ServerAddresses -join ', '; ` +
          `Write-Host "DNS: $dns"`
        );
        break;
      }

      case 'get_battery': {
        result = await ps(
          `$b = Get-WmiObject Win32_Battery -ErrorAction SilentlyContinue; ` +
          `if($b){ ` +
          `  $status = switch($b.BatteryStatus){1{'Ontladen'}2{'AC/Opladen'}else{'Onbekend'}}; ` +
          `  Write-Host "Batterij: $($b.EstimatedChargeRemaining)% — $status — $($b.EstimatedRunTime) min resterend" ` +
          `} else { Write-Host "Geen batterij gevonden (desktop?)" }`
        );
        break;
      }

      case 'wifi_list': {
        result = await ps(`netsh wlan show networks mode=Bssid 2>$null | Select-String "SSID|Signal" | ForEach-Object{$_.Line.Trim()}`);
        result.output = (result.output || 'WiFi niet beschikbaar').slice(0, 3000);
        break;
      }

      case 'ping': {
        const host = (param ?? 'google.com').replace(/[^a-zA-Z0-9.\-]/g, '');
        result = await ps(`Test-Connection "${host}" -Count 3 -ErrorAction SilentlyContinue | Select-Object @{n='Host';e={$_.Address}},@{n='ms';e={$_.ResponseTime}} | ConvertTo-Json`);
        result.output = (result.output || 'Geen reactie').slice(0, 1000);
        break;
      }

      case 'move_mouse': {
        const [mx, my] = (param ?? '').split(',').map(s => parseInt(s.trim()));
        if (!Number.isFinite(mx) || !Number.isFinite(my)) return reply.code(400).send({ ok: false, message: 'Formaat: x,y' });
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);' -Name M -Namespace W -ErrorAction SilentlyContinue; ` +
          `[W.M]::SetCursorPos(${mx},${my})`
        );
        if (result.ok) result.output = `Muis naar ${mx},${my}`;
        break;
      }

      case 'drag': {
        // param: "x1,y1,x2,y2"
        const dparts = (param ?? '').split(',').map(s => parseInt(s.trim()));
        if (dparts.length < 4 || dparts.some(n => !Number.isFinite(n)))
          return reply.code(400).send({ ok: false, message: 'Formaat: x1,y1,x2,y2' });
        const [x1,y1,x2,y2] = dparts;
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);' -Name M -Namespace W -ErrorAction SilentlyContinue; ` +
          `[W.M]::SetCursorPos(${x1},${y1}); Start-Sleep -Milliseconds 60; ` +
          `[W.M]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; ` +
          `[W.M]::SetCursorPos(${x2},${y2}); Start-Sleep -Milliseconds 80; ` +
          `[W.M]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)`
        );
        if (result.ok) result.output = `Sleep van ${x1},${y1} naar ${x2},${y2}`;
        break;
      }

      case 'lock_pc': {
        result = await ps(`rundll32.exe user32.dll,LockWorkStation`);
        if (result.ok) result.output = 'PC vergrendeld';
        break;
      }

      case 'sleep_pc': {
        result = await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend,$false,$false)`);
        if (result.ok) result.output = 'PC gaat in slaapstand';
        break;
      }

      case 'empty_recycle_bin': {
        result = await ps(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue`);
        if (result.ok) result.output = 'Prullenbak geleegd';
        break;
      }

      case 'set_wallpaper': {
        if (!SAFE_PATH.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldig pad' });
        result = await ps(
          `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a,uint b,string c,uint d);' -Name W -Namespace Wall -ErrorAction SilentlyContinue; ` +
          `[Wall.W]::SystemParametersInfo(20,0,"${param.replace(/"/g,'')}",3)`
        );
        if (result.ok) result.output = 'Achtergrond gewijzigd';
        break;
      }

      case 'list_installed': {
        result = await ps(
          `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, ` +
          `HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* ` +
          `-ErrorAction SilentlyContinue | Where-Object DisplayName | ` +
          `Select-Object DisplayName,DisplayVersion,Publisher | Sort-Object DisplayName | ` +
          `Select-Object -First 50 | ConvertTo-Json`
        );
        result.output = (result.output || '').slice(0, 8000);
        break;
      }

      case 'winget_install': {
        if (!SAFE_APP_NAMES.test(param)) return reply.code(400).send({ ok: false, message: 'Ongeldige pakketnaam' });
        result = await ps(`winget install --id "${param.replace(/"/g,'')}" --silent --accept-package-agreements --accept-source-agreements`);
        result.output = (result.output || '').slice(0, 2000);
        break;
      }

      case 'winget_search': {
        if (!param || param.length > 100) return reply.code(400).send({ ok: false, message: 'Ongeldige zoekterm' });
        result = await ps(`winget search "${param.replace(/"/g,'')}" --limit 10`);
        result.output = (result.output || '').slice(0, 3000);
        break;
      }

      case 'get_startup_apps': {
        result = await ps(
          `Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location | ConvertTo-Json`
        );
        result.output = (result.output || '').slice(0, 4000);
        break;
      }

      case 'check_internet': {
        result = await ps(
          `$r = Test-Connection 8.8.8.8 -Count 1 -ErrorAction SilentlyContinue; ` +
          `if($r){ Write-Host "Online — ping Google DNS: $($r.ResponseTime)ms" } else { Write-Host "Geen internetverbinding" }`
        );
        break;
      }

      default:
        return reply.code(400).send({ ok: false, message: `Onbekende actie: ${action}` });
    }

    const richOutput = ['run_command','read_file','list_folder','search_files','get_system_info',
      'get_network_info','get_battery','wifi_list','ping','list_processes','list_installed',
      'winget_search','get_startup_apps','get_volume','read_clipboard'].includes(action);
    const okMsg = richOutput ? `✓ ${result.output}` : `✓ Uitgevoerd`;
    return reply.send({ ok: result.ok, message: result.ok ? okMsg : `✗ ${result.output}` });
  });

  /* List supported actions — used by frontend to show hints */
  fastify.get('/api/system/actions', async (_req, reply) => {
    return reply.send({
      actions: [
        { id: 'open_app',      label: 'App openen',        icon: '🖥',  example: 'notepad / chrome / code' },
        { id: 'open_folder',   label: 'Map openen',        icon: '📁',  example: 'C:\\Users\\naam\\Documents' },
        { id: 'open_file',     label: 'Bestand openen',    icon: '📄',  example: 'C:\\pad\\naar\\bestand.txt' },
        { id: 'open_url',      label: 'Website openen',    icon: '🌐',  example: 'https://google.com' },
        { id: 'create_folder', label: 'Map aanmaken',      icon: '📂',  example: 'C:\\Users\\naam\\NieuweMap' },
        { id: 'write_file',    label: 'Bestand schrijven', icon: '✏️',  example: 'C:\\pad\\bestand.txt|inhoud' },
        { id: 'take_screenshot', label: 'Screenshot',      icon: '📸',  example: '' },
        { id: 'close_app',     label: 'App sluiten',       icon: '✕',   example: 'notepad' },
      ],
    });
  });
}
