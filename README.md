# Agenda Salon 1.1.2

Caius Poputa — Dezvoltator independent · © 2026.

Identificator Android: ro.caiuspoputa.agendasalon. Nume în lista aplicațiilor: Agenda Salon.
Actualizare peste edițiile 1.1.0 și 1.1.1. Ediția veche ro.salon.agenda.test are un identificator diferit.

## Actualizare de la 1.1.0 / 1.1.1

În aplicația instalată deschide Setări → Actualizări aplicație → Verifică acum și confirmă actualizarea. Se păstrează identificatorul și certificatul Android, baza locală cu programări și istoric, clienții, serviciile, prețurile, cheltuielile, setările, logo-ul, activarea și conexiunea HA, inclusiv rolul dispozitivului și modificările în așteptare. Nu dezinstala aplicația, nu șterge datele și nu importa din nou backupul pentru această actualizare.

Interfața este încărcată acum din fișierele APK prin AndroidX WebViewAssetLoader, la o adresă HTTPS locală, la fel ca în Agenda Frizerie. Funcționează offline; adresa nu găzduiește agenda pe internet. La prima deschidere se transferă automat preferințele verificării actualizărilor de la vechea origine WebView. Agenda, conexiunea HA și activarea rămân în depozitele native existente. Transferul se poate relua dacă pornirea a fost întreruptă. Serviciul Atelier Sync și backupurile lui nu necesită modificări.

Actualizează pe rând cele două dispozitive și verifică agenda și indicatorul HA după fiecare actualizare. Clasificarea Play Protect este decisă de Google; schimbarea tehnică nu garantează eliminarea avertismentului.

## Transfer cu import manual din ediția veche 1.0.23 sau anterioară

1. Verifică sincronizarea și salvează un export JSON din aplicația existentă și un backup Atelier Sync în HA.
2. Instalează Agenda Salon pe telefon, activează instalarea online și alege rolul secundar.
3. Păstrează sincronizarea HA oprită și importă manual fișierul JSON din Setări → Date și backup.
4. Verifică programările, istoricul, prețurile, clienții, serviciile, cheltuielile, setările și logo-ul, inclusiv după redeschidere offline.
5. Repetă pe tabletă cu rolul principal. Compară agenda importată cu cea din HA înainte de asociere.

Prima asociere la un HA deja inițializat propune **Preia agenda HA**. Confirmarea înlocuiește agenda locală cu cea a serverului și salvează o copie locală a datelor anterioare asocierii. Verifică diferențele înainte să confirmi. Activarea și conexiunea HA se configurează separat pe fiecare instalare.

- [Ghid de instalare și transfer](https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.2/Agenda-Salon-Instalare.pdf)
- [Ghid de utilizare](https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.2/Agenda-Salon-Utilizare.pdf)
- [Atelier Sync pentru Home Assistant](https://github.com/caiuspoputa-debug/atelier-sync-ha)

## Semnare și actualizări

Certificatul public este în certificates/Caius-Poputa.cer. Amprenta SHA-256 este 95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6.

Cheia privată este păstrată local. Pentru compilare, scriptul android/build.ps1 primește calea și parola din SALON_KEYSTORE_PATH și SALON_KEYSTORE_PASSWORD. Aliasul certificatului existent este geometrie-roti. Compilarea folosește Gradle 9.4.1, Android Gradle Plugin 9.2.1, Android SDK 36 / Build Tools 36.1.0 și AndroidX WebKit 1.18.0. Scriptul rulează offline, după instalarea dependențelor în cache, și verifică semnătura, alinierea și identitatea APK-ului rezultat.

Agenda Salon verifică actualizările la https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json. Descărcările și canalul update.json ale ediției vechi au fost retrase. Versiunile vechi sunt păstrate în arhiva privată. Trecerea de la ediția veche se face prin instalarea separată și transferul descris mai sus. Fiecare instalator verifică identificatorul și certificatul APK-ului înainte de instalare.

Serviciul de activare existent păstrează identificatorii săi de protocol. Aceștia identifică serviciul Salon, independent de numele pachetului Android. Fiecare instalare nouă primește propriul identificator aleatoriu și propria dovadă de activare semnată. PIN-ul se comunică separat.

## Verificări

415 teste ale regulilor aplicației și pornirii, 87 verificări ale migrării originii native, 345 ale activării, 84 ale politicii de actualizare, 48 ale bridge-ului de actualizare și 188 ale selectorului de logo au trecut. Testele bazei native verifică păstrarea exactă a datelor, copia înainte de actualizare și revenirea tranzacției la eroare.

Testul de trecere de la interfața APK-ului semnat 1.1.1 la cea nouă verifică agenda, istoricul, setările, logo-ul, identitatea HA, coada nesincronizată și preferințele actualizatorului. Acesta folosește adaptoare pentru stocarea/bridge-ul Android și un Store Atelier Sync real, cu date sintetice, pentru rolurile principal și secundar. Modificările în așteptare ajung o singură dată în HA; backupul serverului este restaurabil. Nu s-au modificat datele dispozitivelor utilizatorului. Nu a fost disponibil un dispozitiv sau emulator Android pentru verificarea unei instalări efective.
