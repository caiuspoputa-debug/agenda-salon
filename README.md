# Agenda Salon 1.1.7

Caius Poputa - Dezvoltator independent · © 2026.

**[Descarcă Agenda Salon 1.1.7](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.7/Agenda-Salon-1.1.7.apk)** · [Catalog comun](https://caiuspoputa-debug.github.io/aplicatii/).

## Actualizare peste edițiile 1.1.x

În Setări → Actualizări aplicație apasă **Verifică acum**, apoi folosește opțiunea oferită de versiunea instalată. Din 1.1.7 alegi **Descarcă**, deschizi APK-ul din Descărcări și confirmi actualizarea în Android. Instalează peste aplicația existentă, fără dezinstalare, ștergerea datelor sau reimportarea backupului. Actualizează cele două dispozitive pe rând și verifică agenda și indicatorul HA după fiecare.

Rămân același identificator `ro.caiuspoputa.agendasalon` și același certificat. Se păstrează programările, istoricul, clienții, serviciile și ordinea lor, prețurile, cheltuielile, setările, logo-ul, activarea și configurația HA, inclusiv rolul, cheia și operațiile nesincronizate. Atelier Sync și backupurile sale rămân neschimbate.

## Actualizatorul Android, ca în Frizerie

Referința este **Agenda Frizerie 5.0.17**. Salon păstrează verificarea automată la prima deschidere din zi, verificarea manuală și popupul **Descarcă / Mai târziu**, amânat cât timp este deschis un formular. Butonul deschide exclusiv browserul pentru URL-ul HTTPS validat al ediției curente. Utilizatorul deschide APK-ul descărcat și confirmă actualizarea Android.

Instalatorul intern, providerul APK și permisiunea `REQUEST_INSTALL_PACKAGES` au fost eliminate. Nu se descarcă APK-uri în cache-ul Salon și nu se cer permisiuni de instalare. Verificarea sau revenirea în aplicație nu deschid browserul automat. Se păstrează termenele limită, rezultatele întârziate, protecția contra cererilor repetate și preferințele locale de actualizare.

Canalul metadatelor rămâne https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json, compatibil cu edițiile existente. Trecerea la 1.1.7 folosește mecanismul ediției deja instalate. Ediția înlocuită se păstrează în arhiva privată. Această modificare nu este o confirmare de aprobare Play Protect pentru noul APK Salon; clasificarea se verifică separat.

## Numele și iconul

Iconul rămâne **Salon Narcisa 3D**, cu textul și alunița aprobate. În Setări → Spațiul de lucru, **Aplică numele și sub icon** folosește Numele salonului deja salvat. Android cere confirmarea primei scurtături pe fiecare dispozitiv; ulterior numele se actualizează inclusiv prin HA. Numele din lista aplicațiilor rămâne Agenda Salon.

## Ghiduri și HA

- [Ghid de instalare și transfer](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.7/Agenda-Salon-Instalare.pdf)
- [Ghid de utilizare](https://caiuspoputa-debug.github.io/aplicatii/downloads/salon/1.1.7/Agenda-Salon-Utilizare.pdf)
- [Atelier Sync pentru Home Assistant](https://github.com/caiuspoputa-debug/atelier-sync-ha)

Transferul din ediția veche 1.0.23 sau anterioară este o instalare separată, descrisă în ghid. O instalare nouă pornește fără asociere HA; importul manual și prima asociere cer verificarea datelor. Acest transfer nu se repetă la actualizarea obișnuită 1.1.x.

## Compilare și verificări

Certificatul public este în `certificates/Caius-Poputa.cer`, SHA-256 `95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6`. Cheia privată rămâne locală. `android/build.ps1` primește `SALON_KEYSTORE_PATH` și `SALON_KEYSTORE_PASSWORD`, aliasul existent `geometrie-roti`. Build: Gradle 9.4.1, AGP 9.2.1, SDK 36, Build Tools 36.1.0.

Testele includ regulile agendei, verificarea versiunii, deschiderea explicită a browserului, URL-uri respinse, expirarea verificării și rezultate întârziate, activarea, baza locală și actualizarea de la APK-ul 1.1.6 la interfața 1.1.7 pentru ambele roluri HA. Se folosesc date sintetice și un Store Atelier Sync temporar. Certificatul și lipsa instalatorului sunt verificate și în APK-ul compilat. Rezultatele și limitele sunt în Verificari-1.1.7.json; testele gazdă nu echivalează cu o instalare pe un dispozitiv Android fizic.
