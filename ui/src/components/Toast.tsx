import 'sonner/dist/styles.css';
import { Toaster } from 'sonner';
import { useThemeStore } from '../stores/theme';

export function Toast() {
  const theme = useThemeStore((state) => state.theme);
  return <Toaster theme={theme} position="bottom-right" richColors />;
}
