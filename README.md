# koha-nukat-scripts

Zestaw skryptów integrujących centralny katalog Nukat z systemem bibliotecznym Koha.

Skrypty są ciągle rozwijane, więc w przyszłości może pojawić się więcej funkcji.

Funkcje:
- sobotnia kontrola zgodności rekordów i haseł z Nukatem
- codzienne aktualizacje rekordów bibliotecznych i haseł wzorcowych
- przygotowanie plików do corocznej kontroli/porównania rekordów z Nukata i wgranie ich na serwer FTP

## Sobotnia kontrola

Cotygodniowa kontrola zgodności z Nukatem, a także ogólnych nieprawidłowości rekordów w Koha.

Sprawdza:
- rekordy podpięte w Nukacie, a brakujące w Koha
- rekordy w Koha, które są nieaktualne (data modyfikacji starsza niż w Nukacie) 
- rekordy które są w Koha, a nie są podpięte w Nukacie
- rekordy z występującym polem 009, na które prawdopodobnie trzeba zwrócić uwagę
- rekordy zduplikowane
- rekordy z więcej niż jednym typem [pole 942]
- rekordy bez żadnego typu [pole 942]
- hasła wzorcowe zduplikowane
- hasła wzorcowe, które są w Koha, a nie pasują do żadnych rekordów z Nukata
- brakujące hasła wzorcowe w Koha
- hasła wzorcowe, które są nieaktualne
- rekordy bibliograficzne, które są nieaktualne

Wszystkie te kontrole pomagają bibliotece w utrzymaniu na bieżąco zgodności z Nukatem i aktywne eliminowanie wszelkich powstałych nieprawidłowości.

## Codzienny import aktualizacji rekordów

**Uwaga: wymagany jest spatchowany skrypt w Koha `bulkmarcimport2.pl`, który aktualnie nie jest jeszcze upubliczniony.**

Wgrywa codzienne (w odpowiedniej kolejności chronologicznej w przypadku, gdy są dostępe pliki z więcej niż jednego dnia):
- khw dla kopiowanych
- khw dla modyfikowanych
- aktualizacje rekordów haseł wzorcowych
- aktualizacje rekordów bibliograficznych

Pliki wgrane są wpisywanie do listy z bazie danych tak, aby w przyszłości skrypt je pomijał przy kolejnych sprawdzaniach.

## Instalacja

(skrypty są w ciągłym rozwoju, więc instrukcje mogą zmienić się w przyszłości!)

1. Zainstalować bun.js na serwerze
2. Sklonować repozytorium do jakiegoś katalogu (najlepiej do konkretnego commita, na wypadek przyszłych niekompatybilnych zmian)
3. Zaimportować plik `db.sql` do bazy danych.
4. Uzupełnić ustawienia systemowe w systemie Koha w sekcji preferencji systemowych (IP i hasła serwera FTP Nukata oraz ustawienia wysyłki e-mail)
5. Upewnić się, że Koha ma ustawiony domyślny serwer SMTP do wysyłki maili z raportami
6. Skompilować plik `import_helper.c` i nadać mu odpowiednie uprawnienia (instrukcja w środku pliku w komentarzu)
7. Ustawić uruchamianie skryptów w crontab

Uwaga: skrypty aktualnie zakładają, że instancja w Koha nazywa się "biblioteka", w przyszłości nazwa instancji będzie prawdopodobnie argumentem CLI skryptu.

Przykładowy crontab:
```
0 14 * * 6 bun /opt/koha-nukat/scripts/src/sobota.ts
0 7 * * * bun /opt/koha-nukat/scripts/src/marcupdates.ts
```
