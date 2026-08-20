import { shell, systemPreferences } from 'electron'
import type { PermissionsInfo, PermissionState } from '../shared/ipc'

// macOS needs screen-recording permission for system audio and microphone
// permission separately; the setup screen's status dots are driven from here.

export function permissionStatus(): PermissionsInfo {
  if (process.platform !== 'darwin') {
    // Windows/Linux: no OS-level gate we can query — report granted and let
    // the actual capture attempt surface failures.
    return { microphone: 'granted', screen: 'granted' }
  }
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone') as PermissionState,
    screen: systemPreferences.getMediaAccessStatus('screen') as PermissionState
  }
}

export async function requestMicrophone(): Promise<PermissionState> {
  if (process.platform !== 'darwin') return 'granted'
  const granted = await systemPreferences.askForMediaAccess('microphone')
  return granted ? 'granted' : 'denied'
}

/** screen recording can't be prompted programmatically — open the pane */
export async function openScreenRecordingSettings(): Promise<void> {
  if (process.platform === 'darwin') {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  }
}
