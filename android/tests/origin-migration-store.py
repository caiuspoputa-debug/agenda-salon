"""Temporary real HA Store for the personal-identity migration browser check."""
import copy
import json
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[4]
backend = root / 'work/atelier-sync-ha/atelier_sync'
sys.path[:0] = [str(backend), str(backend / 'tests')]
from server import Store, APIError
from test_server import PAIRING, agenda, appointment, expense

sys.stdout.reconfigure(encoding='utf-8')
with tempfile.TemporaryDirectory(prefix='salon-personal-migration-') as temporary:
    store = Store(Path(temporary) / 'agenda.sqlite3', PAIRING)
    old_tablet = store.register({'pairingKey': PAIRING, 'deviceId': 'old-tablet', 'role': 'master', 'name': 'Old tablet'})
    old_phone = store.register({'pairingKey': PAIRING, 'deviceId': 'old-phone', 'role': 'secondary', 'name': 'Old phone'})
    seed = agenda()
    seed['settings']['workspace'].update(salonName='Salon transfer verificat', textSize='large', logoData=(root / 'work/salon-logo-upload-fixture.txt').read_text(encoding='utf-8-sig').strip())
    seed['appointments'] = [appointment('active', date='2030-01-02', price=137.5), appointment('history', date='2025-01-03', status='completed', price=149.5)]
    seed['suppliers'] = [{'id': 'supplier1', 'name': 'Furnizor existent'}]
    seed['expenses'] = [{**expense(), 'supplierId': 'supplier1', 'supplierName': 'Furnizor existent'}]
    original = store.sync(old_tablet['token'], {'deviceId': 'old-tablet', 'workspaceId': old_tablet['workspaceId'], 'operations': [], 'bootstrap': seed, 'bootstrapId': 'original-bootstrap'})
    for line in sys.stdin:
        request = json.loads(line)
        try:
            path, body = request['path'], request.get('body', {})
            if path == '/fixture':
                response = {'state': original['state'], 'pairing': PAIRING, 'devices': {'master': {**old_tablet, 'deviceId': 'old-tablet'}, 'secondary': {**old_phone, 'deviceId': 'old-phone'}}}
            elif path == '/v1/status':
                response = store.status()
            elif path == '/v1/register':
                response = store.register(body)
            elif path == '/v1/sync':
                response = store.sync(request['token'], body)
            elif path == '/verify-backup':
                backup = Path(temporary) / 'copy.sqlite3'
                store.backup(backup)
                restored = Store(backup, PAIRING)
                query = {'deviceId': 'old-phone', 'workspaceId': old_phone['workspaceId'], 'operations': []}
                current = store.sync(old_phone['token'], query)
                assert restored.sync(old_phone['token'], query)['state'] == current['state']
                response = {'restorable': True, 'serverRevision': current['serverRevision'], 'state': current['state']}
            else:
                raise ValueError('Unknown test endpoint')
            result = {'ok': True, 'status': 200, 'body': response}
        except APIError as error:
            result = {'ok': False, 'status': error.status, 'body': {'error': str(error), 'code': error.code}}
        print(json.dumps({'id': request['id'], 'result': result}, ensure_ascii=False), flush=True)
