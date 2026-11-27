export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-muted">
        <p>
          Неофициальный сервис: цены и акции меняет торговая сеть, здесь они могут отставать.
          Не является офертой и не связан с ПАО «Магнит».
        </p>
        <p>
          Координаты магазинов —{' '}
          <a
            className="text-brand underline underline-offset-2"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer noopener"
          >
            OpenStreetMap contributors
          </a>
          , данные лицензии ODbL.
        </p>
      </div>
    </footer>
  );
}
