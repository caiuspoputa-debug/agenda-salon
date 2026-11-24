# Agenda Salon 1.1.5

Caius Poputa - Dezvoltator independent · © 2026.

Icon nou: **Salon Narcisa 3D**, cu textul aprobat și alunița în dreapta imaginii. Numele aplicației rămâne Agenda Salon, iar identificatorul Android rămâne `ro.caiuspoputa.agendasalon`.

**[Descarcă Agenda Salon 1.1.5](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.5/Agenda-Salon-1.1.5.apk)** · [Catalog comun](https://caiuspoputa-debug.github.io/aplicatii/).

## Actualizare peste edițiile 1.1.0-1.1.3

Descarcă APK-ul, deschide fișierul și confirmă **Actualizează** în Android. Instalează peste aplicația existentă, fără dezinstalare, ștergerea datelor sau reimportarea backupului. Actualizează cele două dispozitive pe rând și verifică agenda și indicatorul HA după fiecare.

Se păstrează certificatul, baza locală cu programări și istoric, clienții, serviciile, prețurile, cheltuielile, setările, logo-ul personalizat, activarea și conexiunea HA, inclusiv rolul, cheia și modificările în așteptare. Iconul de lansare este separat de logo-ul configurabil din interiorul aplicației. Atelier Sync și backupurile sale rămân neschimbate.

Verificarea zilnică, verificarea manuală și popupul cu amânare rămân. Din **1.1.5**, butonul **Instalează** descarcă APK-ul oficial în cache-ul privat, verifică SHA-256, dimensiunea, pachetul, versiunea și semnătura, apoi deschide instalatorul Android. Dacă este cerută permisiunea de instalare pentru Agenda Salon, la revenire procesul continuă automat. Instalarea necesită confirmarea Android. Nu se folosește browserul și nu trebuie deschis manual fișierul.

Versiunile 1.1.0-1.1.3 folosesc GitHub Releases, iar 1.1.4 deschide linkul Pages în browser; dacă descărcarea lor eșuează, folosește linkul direct de mai sus. Metadatele rămân compatibile cu aceste versiuni. Versiunile precedente sunt păstrate în arhiva privată.

## Numele de pe ecranul principal

În Setări → Spațiul de lucru, **Aplică numele și sub icon** folosește direct **Numele salonului** deja salvat (de exemplu Salon Narcisa). Android cere confirmarea adăugării unei scurtături cu același icon. Apoi numele scurtăturii se actualizează automat când se schimbă numele salonului, inclusiv prin HA. Nu creează altă instalare sau bază de date. Numele din lista aplicațiilor Android rămâne Agenda Salon. Adăugarea se face separat pe fiecare dispozitiv.

## Transfer cu import manual din ediția veche 1.0.23 sau anterioară

1. Verifică sincronizarea și salvează un export JSON din aplicația existentă și un backup Atelier Sync în HA.
2. Instalează Agenda Salon pe telefon, activează instalarea online și alege rolul secundar.
3. Păstrează sincronizarea HA oprită și importă manual fișierul JSON din Setări → Date și backup.
4. Verifică programările, istoricul, prețurile, clienții, serviciile, cheltuielile, setările și logo-ul, inclusiv după redeschidere offline.
5. Repetă pe tabletă cu rolul principal. Compară agenda importată cu cea din HA înainte de asociere.

Prima asociere la un HA deja inițializat propune **Preia agenda HA**. Confirmarea înlocuiește agenda locală cu cea a serverului și salvează o copie locală a datelor anterioare asocierii. Verifică diferențele înainte să confirmi. Activarea și conexiunea HA se configurează separat pe fiecare instalare.

- [Ghid de instalare și transfer](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.5/Agenda-Salon-Instalare.pdf)
- [Ghid de utilizare](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.5/Agenda-Salon-Utilizare.pdf)
- [Atelier Sync pentru Home Assistant](https://github.com/caiuspoputa-debug/atelier-sync-ha)

## Semnare și compilare

Certificatul public este în `certificates/Caius-Poputa.cer`. SHA-256: `95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6`.

Cheia privată rămâne locală. `android/build.ps1` primește `SALON_KEYSTORE_PATH` și `SALON_KEYSTORE_PASSWORD`; aliasul existent este `geometrie-roti`. Compilarea folosește Gradle 9.4.1, AGP 9.2.1, SDK 36 / Build Tools 36.1.0 și AndroidX WebKit 1.18.0. Scriptul verifică semnătura, alinierea și identitatea APK-ului.

Canalul verificării rămâne https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json. Activarea și încărcarea interfeței offline folosesc aceleași depozite și aceleași mecanisme existente.

## Verificări

415 teste ale regulilor aplicației, 75 verificări ale politicii de actualizare, 53 verificări native ale deschiderii browserului și 345 verificări ale activării au trecut. Testele bazei locale acoperă păstrarea datelor, copiile anterioare actualizării și revenirea tranzacției la eroare.

Testul 1.1.3 → 1.1.5 verifică ambele roluri HA, agenda, istoricul, setările, logo-ul, identitatea dispozitivului, cheia HA, operațiile nesincronizate și preferințele actualizatorului. Folosește adaptoare Android și un Store Atelier Sync real cu date sintetice; operațiile ajung o singură dată la server, iar backupul este restaurabil. Datele dispozitivelor utilizatorului nu au fost accesate. Nu a fost testată instalarea pe un dispozitiv Android fizic sau emulator. Clasificarea Play Protect aparține Google și nu este garantată de schimbarea iconului.
