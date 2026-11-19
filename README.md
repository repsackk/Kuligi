# Kuligi Pod Tatrami — wersja 1.1

## Uruchomienie Windows
1. Zainstaluj Node.js LTS z https://nodejs.org/en/download
2. Zamknij i otwórz ponownie PowerShell. Sprawdź `node -v` i `npm -v`.
3. W folderze projektu: `npm install`
4. Skopiuj `.env.example` jako `.env` i zmień `ADMIN_PASSWORD`.
5. Uruchom `npm start` i wejdź na http://localhost:3000

## Podgląd bez npm
Otwórz `public/index.html` dwuklikiem. Style CSS i interfejs działają lokalnie, lecz API rezerwacji wymaga serwera. Zdjęcia i fonty wymagają Internetu.

## Zaliczka i płatności
Ceny są przykładowe. W podsumowaniu widać zaliczkę 50% i pozostałą część do zapłaty na miejscu. **Przelewy24 nie jest jeszcze aktywne.** Obecny formularz zapisuje wyłącznie zapytanie (`inquiry`), bez pobrania pieniędzy i bez automatycznego potwierdzenia rezerwacji. Nie uruchamiaj sprzedaży przed wdrożeniem podpisanej weryfikacji powiadomień P24, bezpiecznej bazy transakcyjnej, blokad miejsc i regulaminu.

## Gdy Node nie działa
`Test-Path "C:\Program Files\nodejs\node.exe"` — jeśli True, sprawdź `& "C:\Program Files\nodejs\node.exe" -v`; dodaj `C:\Program Files\nodejs\` do PATH.
