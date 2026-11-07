package ro.caiuspoputa.agendasalon;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Exposes an individual verified APK through a read-only URI grant, never a directory. */
public final class UpdateApkProvider extends ContentProvider {
    static final String MIME = "application/vnd.android.package-archive";
    @Override public boolean onCreate() { return true; }
    static File directory(android.content.Context context) { return new File(context.getCacheDir(), "app-updates"); }
    static Uri uri(android.content.Context context, String digest) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".updates")
            .appendPath("apk").appendPath(UpdatePolicy.digest(digest) + ".apk").build();
    }
    private File file(Uri uri) throws FileNotFoundException {
        if (uri == null || !"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null || uri.getPath() == null
                || !uri.getPath().matches("/apk/[a-f0-9]{64}\\.apk")) throw new FileNotFoundException("Unknown update resource");
        File file = new File(directory(getContext()), uri.getLastPathSegment());
        if (!file.isFile() || file.length() <= 0 || file.length() > UpdatePolicy.MAX_APK_BYTES)
            throw new FileNotFoundException("Update is not available");
        return file;
    }
    @Override public String getType(Uri uri) { return MIME; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only update resource");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = file(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            Object[] values = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "Agenda-Salon-update.apk";
                else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
            }
            cursor.addRow(values);
            return cursor;
        } catch (FileNotFoundException invalid) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read-only"); }
}
