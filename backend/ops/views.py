"""
Admin backup management: list, download, create and restore database backups.

Restoring replaces the live database, so it is deliberately hard to do by
accident: admin-only, an explicit confirmation string, a strict filename check,
and a safety backup taken before anything is touched (see restore_db.sh).
"""
import json
import os
import re
import subprocess
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status as http_status

BACKUP_DIR = getattr(settings, 'BACKUP_DIR', '/root/backups')
BACKUP_SCRIPT = getattr(settings, 'BACKUP_SCRIPT', '/root/backup.sh')
RESTORE_SCRIPT = getattr(settings, 'RESTORE_SCRIPT', '/root/restore_db.sh')
STATUS_FILE = os.path.join(BACKUP_DIR, '.restore_status.json')

# Only ever touch files whose names we generated ourselves. This is the guard
# against path traversal — never join user input onto BACKUP_DIR unchecked.
DB_NAME_RE = re.compile(r'^(db_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}|pre_restore_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-\d{2})?(_\d+)?)\.sql\.gz$')
MEDIA_NAME_RE = re.compile(r'^media_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.tar\.gz$')


def _human_size(n):
    size = float(n)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return f"{size:.0f} {unit}" if unit == 'B' else f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} GB"


def _safe_path(name, *, db_only=False):
    """Absolute path for a backup file, or None if the name isn't one of ours."""
    if not name or '/' in name or '\\' in name or '..' in name:
        return None
    if db_only:
        if not DB_NAME_RE.match(name):
            return None
    elif not (DB_NAME_RE.match(name) or MEDIA_NAME_RE.match(name)):
        return None
    path = os.path.join(BACKUP_DIR, name)
    # Belt-and-braces: the resolved path must still sit inside BACKUP_DIR.
    if os.path.realpath(path) != os.path.join(os.path.realpath(BACKUP_DIR), name):
        return None
    return path if os.path.isfile(path) else None


def _list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for name in os.listdir(BACKUP_DIR):
        is_db = bool(DB_NAME_RE.match(name))
        is_media = bool(MEDIA_NAME_RE.match(name))
        if not (is_db or is_media):
            continue
        path = os.path.join(BACKUP_DIR, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        out.append({
            'name': name,
            'kind': 'database' if is_db else 'media',
            'is_safety_copy': name.startswith('pre_restore_'),
            'size': st.st_size,
            'size_human': _human_size(st.st_size),
            'created_at': datetime.fromtimestamp(st.st_mtime, dt_timezone.utc).isoformat(),
        })
    out.sort(key=lambda b: b['created_at'], reverse=True)
    return out


class BackupListView(APIView):
    """GET: every backup on disk. POST: run a backup right now."""
    permission_classes = [IsAdminUser]

    def get(self, request):
        backups = _list_backups()
        return Response({
            'backups': backups,
            'count': len(backups),
            'database_count': sum(1 for b in backups if b['kind'] == 'database'),
            'latest': backups[0]['created_at'] if backups else None,
            'schedule': 'Automatic every night at 02:00, kept for 7 days',
        })

    def post(self, request):
        try:
            proc = subprocess.run(
                ['/bin/bash', BACKUP_SCRIPT], capture_output=True, text=True, timeout=300,
            )
        except subprocess.TimeoutExpired:
            return Response({'detail': 'Backup timed out.'}, status=http_status.HTTP_504_GATEWAY_TIMEOUT)
        if proc.returncode != 0:
            return Response(
                {'detail': 'Backup failed.', 'output': (proc.stdout + proc.stderr)[-500:]},
                status=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({'detail': 'Backup created.', 'backups': _list_backups()})


class BackupDownloadView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request, name):
        path = _safe_path(name)
        if not path:
            raise Http404('Backup not found.')
        return FileResponse(open(path, 'rb'), as_attachment=True, filename=name)


class BackupDeleteView(APIView):
    permission_classes = [IsAdminUser]

    def delete(self, request, name):
        path = _safe_path(name)
        if not path:
            raise Http404('Backup not found.')
        os.remove(path)
        return Response({'detail': 'Backup deleted.', 'backups': _list_backups()})


class BackupRestoreView(APIView):
    """Kick off a restore. Destructive, so it needs an explicit confirmation.

    The work runs detached: restoring stops daphne, which would kill this very
    request. The UI polls BackupRestoreStatusView to follow along.
    """
    permission_classes = [IsAdminUser]

    def post(self, request, name):
        if (request.data.get('confirm') or '').strip().upper() != 'RESTORE':
            return Response(
                {'detail': 'Type RESTORE to confirm — this replaces all current data.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        path = _safe_path(name, db_only=True)
        if not path:
            raise Http404('Database backup not found.')

        # Don't start a second restore on top of one already running.
        current = _read_status()
        if current.get('state') == 'running':
            return Response(
                {'detail': 'A restore is already in progress.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        with open(STATUS_FILE, 'w') as f:
            json.dump({'state': 'running', 'message': 'Starting restore…', 'file': name}, f)

        subprocess.Popen(
            ['/bin/bash', RESTORE_SCRIPT, path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,  # survives daphne being stopped mid-restore
        )
        return Response({
            'detail': 'Restore started. The site will be unavailable for about a minute.',
            'state': 'running',
        })


def _read_status():
    try:
        with open(STATUS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'state': 'idle', 'message': ''}


class BackupRestoreStatusView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(_read_status())
