import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ガソリン価格比較アプリ',
  description: '資源エネルギー庁のガソリン価格データを比較表示',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

