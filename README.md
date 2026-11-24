# Agenda Salon 1.1.6

Caius Poputa - Dezvoltator independent · © 2026.

**[Descarcă Agenda Salon 1.1.6](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.6/Agenda-Salon-1.1.6.apk)** · [Catalog comun](https://caiuspoputa-debug.github.io/aplicatii/).

## Actualizare peste edițiile 1.1.x

În Setări → Actualizări aplicație apasă **Verifică acum**, apoi **Instalează**. Confirmă actualizarea în Android. Instalează peste aplicația existentă, fără dezinstalare, ștergerea datelor sau reimportarea backupului. Actualizează cele două dispozitive pe rând și verifică agenda și indicatorul HA după fiecare.

Rămân același identificator `ro.caiuspoputa.agendasalon` și același certificat. Se păstrează programările, istoricul, clienții, serviciile și ordinea lor, prețurile, cheltuielile, setările, logo-ul, activarea și configurația HA, inclusiv rolul, cheia și operațiile nesincronizate. Atelier Sync și backupurile sale rămân neschimbate.

## Actualizatorul Android, ca în Frizerie

Referința verificată este APK-ul public **Agenda Frizerie 5.0.15**. Salon folosește același flux: verificare automată la prima deschidere din zi, popup **Instalează / Mai târziu**, descărcare doar la apăsarea butonului, direct din GitHub Releases, validarea APK-ului și confirmarea finală Android. Popupul așteaptă închiderea formularelor.

Dacă Android cere permisiunea de instalare din Agenda Salon, acord-o, revino și apasă din nou **Instalează actualizarea**, ca în Frizerie. Simplul acord sau revenirea în aplicație nu pornește descărcarea. Datele de verificare rămân separate de agenda salonului.

Sunt verificate dimensiunea, SHA-256, identificatorul aplicației, versiunea mai nouă și certificatul. Se păstrează protecțiile Salon pentru cereri repetate, întreruperea descărcării și prezentarea instalatorului numai în prim-plan. Această aliniere nu reprezintă o aprobare Play Protect.

Trecerea de la 1.1.5 folosește mecanismul deja instalat, prin catalogul GitHub Pages. Din 1.1.6, descărcările viitoare folosesc GitHub Releases. Canalul metadatelor rămâne https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json, compatibil cu edițiile existente. Versiunile precedente se păstrează în arhiva privată.

## Numele și iconul

Iconul rămâne **Salon Narcisa 3D**, cu textul și alunița aprobate. În Setări → Spațiul de lucru, **Aplică numele și sub icon** folosește Numele salonului deja salvat. Android cere confirmarea primei scurtături pe fiecare dispozitiv; ulterior numele se actualizează inclusiv prin HA. Numele din lista aplicațiilor rămâne Agenda Salon.

## Ghiduri și HA

- [Ghid de instalare și transfer](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.6/Agenda-Salon-Instalare.pdf)
- [Ghid de utilizare](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.6/Agenda-Salon-Utilizare.pdf)
- [Atelier Sync pentru Home Assistant](https://github.com/caiuspoputa-debug/atelier-sync-ha)

Transferul din ediția veche 1.0.23 sau anterioară este o instalare separată, descrisă în ghid. O instalare nouă pornește fără asociere HA; importul manual și prima asociere cer verificarea datelor. Acest transfer nu se repetă la actualizarea obișnuită 1.1.x.

## Compilare și verificări

Certificatul public este în `certificates/Caius-Poputa.cer`, SHA-256 `95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6`. Cheia privată rămâne locală. `android/build.ps1` primește `SALON_KEYSTORE_PATH` și `SALON_KEYSTORE_PASSWORD`, aliasul existent `geometrie-roti`. Build: Gradle 9.4.1, AGP 9.2.1, SDK 36, Build Tools 36.1.0.

Testele includ regulile agendei, actualizatorul nativ, acordul Android și reluarea explicită, integritatea/semnătura APK-ului, confirmarea amânată în fundal, activarea, baza locală și trecerea de la APK-ul 1.1.5 la 1.1.6 pentru ambele roluri HA. Se folosesc date sintetice și un Store Atelier Sync temporar. Rezultatele și limitele sunt în raportul Verificari-1.1.6.json al versiunii publicate; nu s-a folosit un dispozitiv Android fizic sau emulator.
