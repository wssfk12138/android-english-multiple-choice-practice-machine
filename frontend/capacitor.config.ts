import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wssfk.englishpracticemachine',
  appName: '英语刷题机',
  webDir: 'dist',
  android: {
    backgroundColor: '#f3f0e8',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#f3f0e8',
      showSpinner: false,
    },
  },
}

export default config
