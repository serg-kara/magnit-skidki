import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: {
    default: 'Скидки у дома — акции Магнита на карте',
    template: '%s — Скидки у дома',
  },
  description:
    'Неофициальный сервис: акции «Магнита» в Ставропольском и Краснодарском краях на карте OpenStreetMap.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <div className="flex min-h-dvh flex-col">
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
