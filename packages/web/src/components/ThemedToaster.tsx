import { Toaster } from 'sonner';
import { useTheme } from '../lib/theme';

/**
 * sonner 自己画一整套面板，不吃我们的 token，只能把主题喂给它。
 * richColors 下它的成功/失败底色是自带的，两套主题里都够读。
 */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-center" richColors closeButton />;
}
