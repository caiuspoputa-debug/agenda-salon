# Agenda Salon CP 1.1.0

Caius Poputa — Dezvoltator independent · © 2026.

Identificator Android: ro.caiuspoputa.agendasalon. Nume în lista aplicațiilor: Agenda Salon CP.
Se instalează separat de ediția ro.salon.agenda.test.

## Transfer cu import manual

1. Verifică sincronizarea și salvează un export JSON din aplicația existentă și un backup Atelier Sync în HA.
2. Instalează CP pe telefon, activează instalarea online și alege rolul secundar.
3. Păstrează sincronizarea HA oprită și importă manual fișierul JSON din Setări → Date și backup.
4. Verifică programările, istoricul, prețurile, clienții, serviciile, cheltuielile, setările și logo-ul, inclusiv după redeschidere offline.
5. Repetă pe tabletă cu rolul principal. Compară agenda importată cu cea din HA înainte de asociere.

Prima asociere la un HA deja inițializat propune **Preia agenda HA**. Confirmarea înlocuiește agenda locală cu cea a serverului și salvează o copie locală a datelor anterioare asocierii. Verifică diferențele înainte să confirmi. Activarea și conexiunea HA se configurează separat pe fiecare instalare.

- [Ghid de instalare și transfer](https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.0/Agenda-Salon-Instalare.pdf)
- [Ghid de utilizare](https://github.com/caiuspoputa-debug/agenda-salon/releases/download/v1.1.0/Agenda-Salon-Utilizare.pdf)
- [Atelier Sync pentru Home Assistant](https://github.com/caiuspoputa-debug/atelier-sync-ha)

## Semnare și actualizări

Certificatul public este în certificates/Caius-Poputa.cer. Amprenta SHA-256 este 95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6.

Cheia privată este păstrată local. Pentru compilare, scriptul android/build.ps1 primește calea și parola din SALON_KEYSTORE_PATH și SALON_KEYSTORE_PASSWORD. Aliasul certificatului existent este geometrie-roti.

CP verifică actualizările la https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json. Versiunea veche verifică update.json. Fiecare instalator verifică identificatorul și certificatul APK-ului înainte de instalare.

Serviciul de activare existent păstrează identificatorii săi de protocol. Aceștia identifică serviciul Salon, independent de numele pachetului Android. Fiecare instalare CP primește propriul identificator aleatoriu și propria dovadă de activare semnată. PIN-ul se comunică separat.

## Verificări

407 teste ale regulilor aplicației, 345 verificări ale activării native și 84 verificări ale politicii actualizatorului au trecut. Transferul a fost verificat prin interfața aplicației, cu import JSON în mod local și asociere ulterioară la un Store Atelier Sync real, folosind exclusiv date sintetice. Semnătura APK-ului este validă. Verificarea pe dispozitivele utilizatorului urmează pașii din ghid.
