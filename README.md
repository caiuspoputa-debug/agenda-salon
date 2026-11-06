# Agenda Salon pentru Android

Versiunea curentă este **1.0.22**. Aplicație pentru telefon și tabletă, cu agendă locală, clienți, servicii, istoric, rapoarte și sincronizare opțională prin Atelier Sync din Home Assistant. Salon este disponibil doar pentru Android.

## Instalare și activare

Descarcă aplicația din [ultima versiune](https://github.com/caiuspoputa-debug/agenda-salon/releases/latest). Instalează peste aplicația existentă, fără dezinstalare sau ștergerea datelor. Sunt păstrate pachetul Android și certificatul original.

La prima deschidere după trecerea la versiunea cu activare, fiecare instalare cere PIN-ul administratorului și conexiune la internet. Activarea se păstrează la update și este verificată offline. PIN-ul nu este inclus în APK, surse, backupuri sau sincronizarea HA. Receiptul este semnat și criptat separat în Android Keystore. Nu este necesar un cont Google pentru activare.

Programările, clienții, istoricul corecțiilor, serviciile, setările și asocierea HA rămân păstrate. Exportă periodic un backup din Setări. Dezinstalarea sau ștergerea datelor elimină stocarea locală și activarea.

## Logo

Instalările noi pornesc cu locul logo gol. Actualizarea păstrează logo-urile personalizate și valorile `null` explicite. Logo-ul implicit vechi, atunci când câmpul lipsea, este salvat prin fluxul normal de modificare a agendei. Logo-ul se poate încărca și schimba din Setări și se sincronizează prin Atelier Sync0.4.0 sau mai nou.

## Actualizări și backup

Verificarea automată se face discret la prima deschidere/revenire din zi. **Setări → Actualizări aplicație → Verifică acum** afișează rezultatul manual. Descărcarea începe doar după alegerea utilizatorului; fișierul este verificat ca dimensiune, SHA256, pachet, versiune și certificat. Android cere confirmarea instalării.

Metadate: [update.json](https://caiuspoputa-debug.github.io/agenda-salon/update.json). Rămâne disponibilă și [adresa pentru versiunile anterioare](https://github.com/caiuspoputa-debug/agenda-salon/releases/latest/download/update.json).

Serviciul HA este separat: [Atelier Sync](https://github.com/caiuspoputa-debug/atelier-sync-ha). Activarea nu înlocuiește sincronizarea HA și nu trimite datele salonului către serviciul de activare.

## Surse și distribuție

Acest depozit conține numai sursa protejată curentă și distribuția Android curentă. Sursele Android sunt în `android/`. Cheia privată de semnare și secretele serviciului nu sunt incluse. `android/build.ps1` cere cheia originală și parola ei prin mediul local.

Istoricul distribuțiilor vechi este păstrat într-o arhivă privată. Copiile deja descărcate sau distribuite în afara GitHub nu pot fi retrase prin schimbarea acestui depozit.
