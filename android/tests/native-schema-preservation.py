import pathlib, re, sqlite3, json, tempfile, threading, time

source = pathlib.Path(__file__).resolve().parents[1] / 'app/src/main/java/ro/caiuspoputa/agendasalon/MainActivity.java'
code = source.read_text(encoding='utf-8')
tables = re.findall(r'db\.execSQL\("(CREATE TABLE [^"]+)"\)', code)
table_sql = {re.search(r'CREATE TABLE(?: IF NOT EXISTS)? (\w+)', sql).group(1): sql for sql in tables}
assert len(tables) == 4 and set(table_sql) == {'app_snapshot', 'local_device', 'update_recovery', 'app_release'}, table_sql
snapshot_sql = table_sql['app_snapshot']
device_sql = table_sql['local_device']
recovery_sql = table_sql['update_recovery']
release_sql = table_sql['app_release']
copy_sql = re.search(r'"(INSERT OR REPLACE INTO update_recovery [^"]+)"', code).group(1)
marker_sql = re.search(r'"(INSERT OR REPLACE INTO app_release [^"]+)"', code).group(1)
db = sqlite3.connect(':memory:')
db.execute(snapshot_sql)
original = '{"appointments":[{"id":"existing-appointment"}]}'
db.execute('INSERT INTO app_snapshot VALUES (1,?,1)', (original,))
db.commit()
# Schema 1 -> 2 uses exactly the additive statement present in onUpgrade.
db.execute(device_sql)
db.commit()
assert db.execute('SELECT json FROM app_snapshot WHERE id=1').fetchone()[0] == original
assert db.execute('SELECT count(*) FROM local_device').fetchone()[0] == 0
with db:
    db.execute('INSERT OR REPLACE INTO app_snapshot VALUES (1,?,2)', ('{"appointments":[{"id":"new"}]}',))
    db.execute('INSERT OR REPLACE INTO local_device VALUES (1,?,2)', ('{"role":"master","outbox":["new"]}',))
saved_state = db.execute('SELECT json FROM app_snapshot WHERE id=1').fetchone()[0]
saved_device = db.execute('SELECT json FROM local_device WHERE id=1').fetchone()[0]
try:
    with db:
        db.execute('INSERT OR REPLACE INTO app_snapshot VALUES (1,?,3)', ('{"appointments":[]}',))
        db.execute('INSERT OR REPLACE INTO local_device VALUES (2,?,3)', ('{}',))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('Expected device write failure')
assert db.execute('SELECT json FROM app_snapshot WHERE id=1').fetchone()[0] == saved_state
assert db.execute('SELECT json FROM local_device WHERE id=1').fetchone()[0] == saved_device
with db:
    db.execute('INSERT OR REPLACE INTO local_device VALUES (1,?,4)', ('{"role":"slave"}',))
assert db.execute('SELECT json FROM app_snapshot WHERE id=1').fetchone()[0] == saved_state
print('Native schema SQL: upgrade preserves snapshot; paired commit/rollback and metadata-only save pass.')


def prepare_release(connection, version, stamp=1234):
    """Exact source SQL inside the caller's transaction, as in prepareRelease(db)."""
    current = connection.execute('SELECT version_code FROM app_release WHERE id=1').fetchone()
    if current is None or current[0] != version:
        connection.execute(copy_sql, (version, stamp))
        connection.execute(marker_sql, (version, stamp))


def new_database():
    connection = sqlite3.connect(':memory:')
    for sql in table_sql.values():
        connection.execute(sql)
    connection.commit()
    return connection


upgrade_state = ''' {\n "version":1, "services":[{"id":"z-first","name":"Primul șță🙂"},{"id":"a-last","name":"Ultimul"}],
 "appointments":[{"id":"historic","date":"2024-02-29","start":"09:17","duration":77,"status":"completed","corrections":[{"at":"2024-02-29T08:00:00.000Z","before":{"price":90},"after":{"price":95}}]}]
} '''
upgrade_device = ' {"token":"secret-only-in-device", "queue":[{"id":"pending"}], "base":{"services":["z-first","a-last"]}} '
with db:
    db.execute('UPDATE app_snapshot SET json=?,updated_at=20 WHERE id=1', (upgrade_state,))
    db.execute('UPDATE local_device SET json=?,updated_at=21 WHERE id=1', (upgrade_device,))
db.execute('PRAGMA user_version=2')
before_snapshot = db.execute('SELECT * FROM app_snapshot').fetchall()
before_device = db.execute('SELECT * FROM local_device').fetchall()
with db:
    db.execute(recovery_sql)
    db.execute(release_sql)
    db.execute('PRAGMA user_version=3')
assert db.execute('PRAGMA user_version').fetchone()[0] == 3
assert db.execute('SELECT * FROM app_snapshot').fetchall() == before_snapshot
assert db.execute('SELECT * FROM local_device').fetchall() == before_device
with db:
    prepare_release(db, 15)
assert db.execute('SELECT json,version_code FROM update_recovery').fetchone() == (upgrade_state, 15)
assert db.execute('SELECT * FROM app_snapshot').fetchall() == before_snapshot
assert db.execute('SELECT * FROM local_device').fetchall() == before_device
assert 'secret-only-in-device' not in db.execute('SELECT json FROM update_recovery').fetchone()[0]
recovery_before = db.execute('SELECT * FROM update_recovery').fetchall()
with db:
    db.execute(recovery_sql)  # Additive creation must preserve an existing recovery copy.
    db.execute(release_sql)
    db.execute('UPDATE app_snapshot SET json=?,updated_at=22 WHERE id=1', ('{"new_version_edit":true}',))
    prepare_release(db, 15, stamp=9999)
assert db.execute('SELECT * FROM update_recovery').fetchall() == recovery_before
with db:
    prepare_release(db, 16)
assert db.execute('SELECT json,version_code FROM update_recovery').fetchone() == ('{"new_version_edit":true}', 16)
with db:
    db.execute('DELETE FROM app_snapshot')
    prepare_release(db, 17)
assert db.execute('SELECT json,version_code FROM update_recovery').fetchone() == ('{"new_version_edit":true}', 16)
print('Native recovery SQL: upgrade 2->3 preserves raw service order/dates/audit and device metadata; exact business-only copy; existing copy survives same-version reopen and empty updates.')

fresh = new_database()
with fresh:
    prepare_release(fresh, 1)
assert fresh.execute('SELECT * FROM update_recovery').fetchone() is None
with fresh:
    fresh.execute('INSERT INTO app_snapshot VALUES(1,?,1)', (upgrade_state,))
    prepare_release(fresh, 1)
assert fresh.execute('SELECT * FROM update_recovery').fetchone() is None
with fresh:
    prepare_release(fresh, 2)
assert fresh.execute('SELECT json,version_code FROM update_recovery').fetchone() == (upgrade_state, 2)
print('Native recovery SQL: fresh install has no recovery copy; same-version initial saves cannot create one; next update captures the existing raw snapshot.')

# Force both recovery-write and marker failures; neither may partially save state/device.
for failed_table in ['update_recovery', 'app_release']:
    failure = new_database()
    with failure:
        failure.execute('INSERT INTO app_snapshot VALUES(1,?,1)', (upgrade_state,))
        failure.execute('INSERT INTO local_device VALUES(1,?,1)', (upgrade_device,))
        failure.execute('INSERT INTO update_recovery VALUES(1,?,10,10)', ('previous recovery',))
        failure.execute('INSERT INTO app_release VALUES(1,10,10)')
    previous_recovery = failure.execute('SELECT * FROM update_recovery').fetchall()
    failure.execute('CREATE TRIGGER force_failure BEFORE INSERT ON ' + failed_table + " BEGIN SELECT RAISE(ABORT,'forced recovery failure'); END")
    try:
        with failure:
            prepare_release(failure, 20)
            failure.execute("UPDATE app_snapshot SET json='must not be saved'")
            failure.execute("UPDATE local_device SET json='must not be saved'")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('Expected recovery failure on ' + failed_table)
    assert failure.execute('SELECT json FROM app_snapshot').fetchone() == (upgrade_state,)
    assert failure.execute('SELECT json FROM local_device').fetchone() == (upgrade_device,)
    assert failure.execute('SELECT * FROM update_recovery').fetchall() == previous_recovery
    assert failure.execute('SELECT version_code FROM app_release').fetchone() == (10,)
    failure.close()
assert 'oldVersion < 3' in code and 'DROP TABLE' not in code
assert re.search(r'onOpen\(SQLiteDatabase db\).*?prepareRelease\(db\)', code, re.S)
for method in ['saveSnapshot', 'saveDevice', 'saveLocal']:
    body = re.search(r'synchronized void ' + method + r'\([^)]*\) \{(.*?)\n        \}', code, re.S).group(1)
    assert body.index('prepareRelease(db)') < body.index('writeRow(db')
assert '@JavascriptInterface public boolean hasUpdateBackup()' in code
assert '@JavascriptInterface public String loadUpdateBackup()' in code
print('Native recovery failure injection: recovery/marker failures roll back old backup, marker, business and metadata; all three save paths and recovery bridge methods are guarded.')

def read_chunks(connection, table, after_first=None):
    connection.execute('BEGIN IMMEDIATE')  # Android beginTransactionNonExclusive uses an immediate transaction.
    try:
        row = connection.execute(f'SELECT length(json) FROM {table} WHERE id=1').fetchone()
        if row is None:
            connection.commit()
            return ''
        pieces = []
        for offset in range(1, row[0]+1, 128*1024):
            piece = connection.execute(f'SELECT substr(json, ?, ?) FROM {table} WHERE id=1', (offset,128*1024)).fetchone()[0]
            assert len(piece.encode('utf-8')) <= 512*1024
            pieces.append(piece)
            if offset == 1 and after_first:
                after_first()
        connection.commit()
        return ''.join(pieces)
    except BaseException:
        connection.rollback()
        raise

with tempfile.TemporaryDirectory(prefix='native-sql-', dir=source.parents[8]) as temp:
    filename = str(pathlib.Path(temp)/'test.db')
    local = sqlite3.connect(filename)
    local.execute(snapshot_sql)
    local.execute(device_sql)
    local.commit()
    assert read_chunks(local,'app_snapshot') == ''
    assert read_chunks(local,'local_device') == ''
    large = json.dumps({'notes':'șță日本語🙂'*180000}, ensure_ascii=False, separators=(',',':'))
    metadata = json.dumps({'base':large,'localBackup':large,'queue':[]}, ensure_ascii=False, separators=(',',':'))
    assert len(large.encode('utf-8')) > 2*1024*1024
    assert len(metadata.encode('utf-8')) > 2*1024*1024
    with local:
        local.execute('INSERT INTO app_snapshot VALUES (1,?,1)', (large,))
        local.execute('INSERT INTO local_device VALUES (1,?,1)', (metadata,))
    assert read_chunks(local,'app_snapshot') == large
    assert read_chunks(local,'local_device') == metadata
    started, finished = threading.Event(), threading.Event()
    failures = []
    def writer():
        try:
            other = sqlite3.connect(filename, timeout=5)
            started.set()
            with other:
                other.execute('UPDATE app_snapshot SET json=? WHERE id=1', ('{"new":true}',))
            other.close()
            finished.set()
        except BaseException as error:
            failures.append(error)
    worker = threading.Thread(target=writer)
    def after_first():
        worker.start()
        assert started.wait(1)
        time.sleep(.05)
        assert not finished.is_set(), 'A writer changed the row during the read transaction'
    assert read_chunks(local,'app_snapshot',after_first) == large
    worker.join(5)
    assert not failures and finished.is_set()
    assert read_chunks(local,'app_snapshot') == '{"new":true}'
    local.close()
print('Native chunk SQL: empty startup, >2 MiB Unicode state/device and consistent concurrent reads pass.')
