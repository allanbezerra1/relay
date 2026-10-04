#!/usr/bin/env python3
"""Relay: import old WhatsApp history (electron/imports.cjs runs this).

  wa_import.py backups --root DIR
  wa_import.py scan    --backup DIR [--password-env VAR]
  wa_import.py extract --backup DIR --out OUT --chats PK,PK... [--media] [--password-env VAR]
  wa_import.py zip     --file EXPORT.zip [--out OUT] [--me NAME] [--key KEY]

Sources: an iPhone backup on this computer (made by Finder on macOS, or by idevicebackup2 on
Linux), which holds WhatsApp's own database (ChatStorage.sqlite) with every chat and its media;
or the .zip from WhatsApp's "Export chat". The backup is only read, never modified.
Output is JSON on stdout; progress as JSON lines on stderr.
"""
import argparse, json, os, re, shutil, sqlite3, sys, tempfile, zipfile, plistlib
from datetime import datetime, timezone

WA_DOMAIN = "AppDomainGroup-group.net.whatsapp.WhatsApp.shared"
APPLE_EPOCH = 978307200  # 2001-01-01 in Unix time


def progress(**kw):
    sys.stderr.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def fail(code, message):
    out({"ok": False, "error": code, "message": message})
    sys.exit(1)


NO_ACCESS = "Relay isn't allowed to read the iPhone backup. Give it Full Disk Access and try again."


# ---------- Listing the backups Finder made (macOS) ----------

def read_plist(path):
    try:
        with open(path, "rb") as f:
            return plistlib.load(f)
    except PermissionError:
        raise
    except Exception:  # noqa: BLE001 - missing or damaged plist
        return {}


def cmd_backups(a):
    try:
        names = sorted(os.listdir(a.root))
    except FileNotFoundError:
        out({"ok": True, "backups": []})
        return
    except PermissionError:
        fail("no_access", NO_ACCESS)
    backups = []
    for name in names:
        d = os.path.join(a.root, name)
        if name.startswith(".") or not os.path.isdir(d):
            continue
        try:
            info = read_plist(os.path.join(d, "Info.plist"))
            manifest = read_plist(os.path.join(d, "Manifest.plist"))
            complete = os.path.exists(os.path.join(d, "Manifest.db"))
        except PermissionError:
            fail("no_access", NO_ACCESS)
        when = info.get("Last Backup Date")
        if isinstance(when, datetime):
            when = int((when if when.tzinfo else when.replace(tzinfo=timezone.utc)).timestamp() * 1000)
        else:
            when = None
        apps = info.get("Installed Applications") or []
        backups.append({
            "id": name,
            "name": info.get("Device Name") or info.get("Display Name") or "iPhone",
            "product": info.get("Product Name") or info.get("Product Type") or "",
            "version": info.get("Product Version") or "",
            "date": when,
            "encrypted": bool(manifest.get("IsEncrypted")),
            "whatsapp": None if not apps else any(str(x).startswith("net.whatsapp.") for x in apps),
            "complete": complete,
        })
    backups.sort(key=lambda b: -(b["date"] or 0))
    out({"ok": True, "backups": backups})


# ---------- iPhone backup ----------

def device_dir(path):
    """idevicebackup2 writes DIR/<UDID>/Manifest.db; Finder's backups are already <UDID>. Accept either."""
    if os.path.exists(os.path.join(path, "Manifest.db")):
        return path
    for name in sorted(os.listdir(path)) if os.path.isdir(path) else []:
        sub = os.path.join(path, name)
        if os.path.exists(os.path.join(sub, "Manifest.db")):
            return sub
    fail("no_backup", "No iPhone backup found in that folder.")


class Backup:
    def __init__(self, path, password=None):
        self.dir = device_dir(path)
        with open(os.path.join(self.dir, "Manifest.plist"), "rb") as f:
            self.encrypted = bool(plistlib.load(f).get("IsEncrypted"))
        self.tmp = tempfile.mkdtemp(prefix="relay-wa-")
        self.enc = None
        if self.encrypted:
            if not password:
                fail("needs_password", "This backup is encrypted. Enter the iPhone backup password.")
            try:
                from iphone_backup_decrypt import EncryptedBackup
            except ImportError:
                fail("needs_decrypt_lib", "The module that opens encrypted backups is missing.")
            try:
                self.enc = EncryptedBackup(backup_directory=self.dir, passphrase=password)
                self.enc.test_decryption()
            except PermissionError:
                raise
            except Exception:  # noqa: BLE001
                fail("bad_password", "Wrong backup password.")
            manifest = os.path.join(self.tmp, "Manifest.db")
            self.enc.save_manifest_file(manifest)
            self.manifest = sqlite3.connect(manifest)
        else:
            self.manifest = sqlite3.connect(f"file:{os.path.join(self.dir, 'Manifest.db')}?mode=ro", uri=True)

    def file_id(self, relative):
        row = self.manifest.execute("SELECT fileID FROM Files WHERE domain = ? AND relativePath = ?", (WA_DOMAIN, relative)).fetchone()
        return row[0] if row else None

    def copy(self, relative, dest):
        """Copies one file of WhatsApp's app group out of the backup. Returns dest or None."""
        fid = self.file_id(relative)
        if not fid:
            return None
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if self.enc:
            try:
                self.enc.extract_file(relative_path=relative, domain_like=WA_DOMAIN, output_filename=dest)
            except Exception:  # noqa: BLE001
                return None
        else:
            src = os.path.join(self.dir, fid[:2], fid)
            if not os.path.exists(src):
                return None
            shutil.copyfile(src, dest)
        return dest

    def chat_db(self):
        dest = os.path.join(self.tmp, "ChatStorage.sqlite")
        if not self.copy("ChatStorage.sqlite", dest):
            fail("no_whatsapp", "This backup doesn't include WhatsApp (or WhatsApp isn't installed on that iPhone).")
        db = sqlite3.connect(dest)
        db.row_factory = sqlite3.Row
        return db

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def cols(db, table):
    try:
        return {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    except sqlite3.Error:
        return set()


def unix(apple):
    return int((float(apple or 0) + APPLE_EPOCH) * 1000)


def cmd_scan(a):
    b = Backup(a.backup, os.environ.get(a.password_env or "", ""))
    try:
        db = b.chat_db()
        c = cols(db, "ZWACHATSESSION")
        kind = "s.ZSESSIONTYPE" if "ZSESSIONTYPE" in c else "0"
        rows = db.execute(f"""
            SELECT s.Z_PK AS pk, s.ZCONTACTJID AS jid, s.ZPARTNERNAME AS name, {kind} AS kind,
                   COUNT(m.Z_PK) AS n, MIN(m.ZMESSAGEDATE) AS first, MAX(m.ZMESSAGEDATE) AS last
            FROM ZWACHATSESSION s JOIN ZWAMESSAGE m ON m.ZCHATSESSION = s.Z_PK
            GROUP BY s.Z_PK HAVING n > 0 ORDER BY last DESC""").fetchall()
        chats = []
        for r in rows:
            jid = r["jid"] or ""
            if jid.endswith("@status") or jid == "status@broadcast":
                continue
            chats.append({
                "pk": r["pk"], "jid": jid, "name": r["name"] or jid.split("@")[0],
                "group": jid.endswith("@g.us"), "count": r["n"], "first": unix(r["first"]), "last": unix(r["last"]),
            })
        out({"ok": True, "encrypted": b.encrypted, "chats": chats})
    finally:
        b.close()


TYPE = {0: "text", 1: "image", 2: "video", 3: "audio", 4: "contact", 5: "location", 7: "text", 8: "file", 11: "image", 15: "sticker"}


def cmd_extract(a):
    b = Backup(a.backup, os.environ.get(a.password_env or "", ""))
    try:
        db = b.chat_db()
        mcols = cols(db, "ZWAMESSAGE")
        has_member = "ZGROUPMEMBER" in mcols
        members = {}
        if has_member and cols(db, "ZWAGROUPMEMBER"):
            gm = cols(db, "ZWAGROUPMEMBER")
            name_col = "ZCONTACTNAME" if "ZCONTACTNAME" in gm else ("ZFIRSTNAME" if "ZFIRSTNAME" in gm else None)
            for r in db.execute(f"SELECT Z_PK, ZMEMBERJID{', ' + name_col if name_col else ''} FROM ZWAGROUPMEMBER"):
                members[r[0]] = (r[1], r[2] if name_col else None)
        pushnames = {}
        if cols(db, "ZWAPROFILEPUSHNAME"):
            for r in db.execute("SELECT ZJID, ZPUSHNAME FROM ZWAPROFILEPUSHNAME"):
                pushnames[r[0]] = r[1]
        media_paths = {}
        if cols(db, "ZWAMEDIAITEM"):
            mi = cols(db, "ZWAMEDIAITEM")
            title = "ZTITLE" if "ZTITLE" in mi else "NULL"
            for r in db.execute(f"SELECT Z_PK, ZMEDIALOCALPATH, {title} FROM ZWAMEDIAITEM"):
                media_paths[r[0]] = (r[1], r[2])

        wanted = [int(x) for x in a.chats.split(",") if x.strip()]
        sessions = {r["Z_PK"]: r for r in db.execute("SELECT Z_PK, ZCONTACTJID, ZPARTNERNAME FROM ZWACHATSESSION")}
        total = sum(db.execute("SELECT COUNT(*) FROM ZWAMESSAGE WHERE ZCHATSESSION = ?", (pk,)).fetchone()[0] for pk in wanted)
        done = 0
        result = []
        for pk in wanted:
            s = sessions.get(pk)
            if not s:
                continue
            jid = s["ZCONTACTJID"] or ""
            group = jid.endswith("@g.us")
            key = re.sub(r"[^A-Za-z0-9_.-]", "_", jid or f"chat{pk}")
            media_dir = os.path.join(a.out, "media", key)
            msgs = []
            q = f"""SELECT Z_PK, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZFROMJID, ZMESSAGETYPE, ZMEDIAITEM{', ZGROUPMEMBER' if has_member else ''}
                    FROM ZWAMESSAGE WHERE ZCHATSESSION = ? ORDER BY ZMESSAGEDATE"""
            for r in db.execute(q, (pk,)):
                done += 1
                if done % 500 == 0:
                    progress(phase="messages", done=done, total=total)
                kind = TYPE.get(r["ZMESSAGETYPE"], None)
                if kind is None:
                    continue  # group events, deleted messages, calls...
                me = bool(r["ZISFROMME"])
                who_jid = None
                who = None
                if not me:
                    if group and has_member and r["ZGROUPMEMBER"] in members:
                        who_jid, who = members[r["ZGROUPMEMBER"]]
                    else:
                        who_jid = r["ZFROMJID"] or jid
                    who = who or pushnames.get(who_jid) or (s["ZPARTNERNAME"] if not group else None) or (who_jid or "").split("@")[0]
                m = {"id": f"wa{r['Z_PK']}", "ts": unix(r["ZMESSAGEDATE"]), "me": me, "from": who_jid, "name": "You" if me else who, "type": kind, "text": r["ZTEXT"] or ""}
                if kind != "text" and r["ZMEDIAITEM"] in media_paths:
                    local, title = media_paths[r["ZMEDIAITEM"]]
                    if title and not m["text"]:
                        m["text"] = title
                    if a.media and local:
                        rel = local if local.startswith("Message/") else f"Message/{local.lstrip('/')}"
                        dest = os.path.join(media_dir, os.path.basename(local))
                        if b.copy(rel, dest):
                            m["media"] = os.path.relpath(dest, a.out)
                if kind == "text" and not m["text"]:
                    continue
                msgs.append(m)
            name = s["ZPARTNERNAME"] or jid.split("@")[0]
            with open(os.path.join(a.out, f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump({"key": key, "jid": jid, "name": name, "group": group, "source": "iphone", "messages": msgs}, f, ensure_ascii=False)
            result.append({"key": key, "jid": jid, "name": name, "group": group, "count": len(msgs), "source": "iphone",
                           "first": msgs[0]["ts"] if msgs else None, "last": msgs[-1]["ts"] if msgs else None})
            progress(phase="chat", name=name, done=done, total=total)
        out({"ok": True, "chats": result})
    finally:
        b.close()


# ---------- "Export chat" .zip ----------

# Invisible marks WhatsApp puts around names and attachments (LRM, RLM, LRE, PDF, NBSP, BOM).
LRM = "‎‏‪‬ ﻿"
IOS = re.compile(r"^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\] ([^:]+?): (.*)$")
ANDROID = re.compile(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\s*[-–] ([^:]+?): (.*)$")
ATTACH_IOS = re.compile(r"<(?:attached|anexado|adjunto):\s*([^>]+)>")
ATTACH_ANDROID = re.compile(r"^(.+?\.\w{2,5}) \((?:file attached|arquivo anexado|archivo adjunto)\)")
# A dated line that isn't "name: text" is a system line ("X added Y", "X changed the subject").
DATED = re.compile(r"^\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},? \d{1,2}:\d{2}")
# The notice WhatsApp puts first in every export, attributed to the chat itself on iOS.
NOTICE = re.compile(r"^(?:Messages and calls are end-to-end encrypted|As mensagens e as chamadas são protegidas|Los mensajes y las llamadas están cifrados)", re.I)
OMITTED = re.compile(r"^<?(?:Media omitted|image omitted|video omitted|audio omitted|sticker omitted|document omitted|GIF omitted"
                     r"|M[íi]dia oculta|imagem ocultada|vídeo omitido|áudio omitido|figurinha omitida|documento omitido)>?$", re.I)
OMITTED_KIND = (("image", "image"), ("imagem", "image"), ("gif", "image"), ("video", "video"), ("vídeo", "video"),
                ("audio", "audio"), ("áudio", "audio"), ("sticker", "sticker"), ("figurinha", "sticker"))
KIND_BY_EXT = {"jpg": "image", "jpeg": "image", "png": "image", "heic": "image", "gif": "image", "webp": "sticker",
               "mp4": "video", "mov": "video", "3gp": "video", "opus": "audio", "ogg": "audio", "m4a": "audio", "aac": "audio", "mp3": "audio"}


def parse_lines(lines):
    raw = []
    for line in lines:
        line = line.strip("\r\n").lstrip(LRM)
        m = IOS.match(line) or ANDROID.match(line)
        if m:
            if not NOTICE.match(m.group(9).lstrip(LRM)):
                raw.append(list(m.groups()))
        elif DATED.match(line):
            raw.append(None)  # a system line ends the previous message
        elif raw and raw[-1] is not None:
            raw[-1][8] += "\n" + line.lstrip(LRM)
    raw = [r for r in raw if r is not None]
    # Day/month order: a first field above 12 means day-first, a second one month-first. When every
    # date is ambiguous, 12-hour clocks (AM/PM) suggest the US order; otherwise day-first.
    if any(int(r[0]) > 12 for r in raw):
        day_first = True
    elif any(int(r[1]) > 12 for r in raw):
        day_first = False
    else:
        day_first = not any(r[6] for r in raw)
    msgs = []
    for d1, d2, y, hh, mm, ss, ampm, who, text in raw:
        day, mon = (int(d1), int(d2)) if day_first else (int(d2), int(d1))
        year = int(y) + (2000 if len(y) == 2 else 0)
        h = int(hh)
        if ampm:
            pm = ampm.lower().startswith("p")
            h = (h % 12) + (12 if pm else 0)
        try:
            ts = int(datetime(year, mon, day, h, int(mm), int(ss or 0)).timestamp() * 1000)
        except ValueError:
            continue
        msgs.append({"ts": ts, "who": who.strip(LRM + " "), "text": text.strip(LRM)})
    return msgs


def cmd_zip(a):
    with zipfile.ZipFile(a.file) as z:
        txt = next((n for n in z.namelist() if n.endswith(".txt") and not n.startswith("__MACOSX")), None)
        if not txt:
            fail("no_chat", "This .zip doesn't contain the chat file (_chat.txt).")
        lines = z.read(txt).decode("utf-8-sig", errors="replace").splitlines()
        parsed = parse_lines(lines)
        if not parsed:
            fail("empty", "No messages recognized in this file.")
        senders = {}
        for p in parsed:
            senders[p["who"]] = senders.get(p["who"], 0) + 1
        base = os.path.splitext(os.path.basename(a.file))[0]
        title = re.sub(r"^(?:WhatsApp Chat (?:with|-)|Conversa do WhatsApp com|Chat de WhatsApp con)\s*", "", base).strip(" -") or base
        if not a.out:  # just looking: who's in it (to ask "which one is you?")
            out({"ok": True, "name": title, "count": len(parsed), "senders": sorted(senders.items(), key=lambda x: -x[1]),
                 "first": parsed[0]["ts"], "last": parsed[-1]["ts"]})
            return
        key = a.key or re.sub(r"[^A-Za-z0-9_.-]", "_", f"zip-{title}")[:80]
        media_dir = os.path.join(a.out, "media", key)
        names = set(z.namelist())
        msgs = []
        for i, p in enumerate(parsed):
            text, kind, media = p["text"], "text", None
            att = ATTACH_IOS.search(text) or ATTACH_ANDROID.match(text)
            if att:
                fname = att.group(1).strip()
                ext = fname.rsplit(".", 1)[-1].lower()
                kind = KIND_BY_EXT.get(ext, "file")
                if fname in names:
                    os.makedirs(media_dir, exist_ok=True)
                    dest = os.path.join(media_dir, os.path.basename(fname))
                    with z.open(fname) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    media = os.path.relpath(dest, a.out)
                text = (ATTACH_IOS.sub("", text) if ATTACH_IOS.search(text) else "").strip()
            elif OMITTED.match(text.strip()):
                low = text.strip().lower()
                kind = next((k for word, k in OMITTED_KIND if word in low), "file")
                text = ""
            me = bool(a.me) and p["who"] == a.me
            m = {"id": f"z{i}", "ts": p["ts"], "me": me, "from": None, "name": "You" if me else p["who"], "type": kind, "text": text}
            if media:
                m["media"] = media
            if kind == "text" and not text:
                continue
            msgs.append(m)
        group = len(senders) > 2
        with open(os.path.join(a.out, f"{key}.json"), "w", encoding="utf-8") as f:
            json.dump({"key": key, "jid": None, "name": title, "group": group, "source": "zip", "messages": msgs}, f, ensure_ascii=False)
        out({"ok": True, "chats": [{"key": key, "jid": None, "name": title, "group": group, "count": len(msgs), "source": "zip",
                                     "first": msgs[0]["ts"] if msgs else None, "last": msgs[-1]["ts"] if msgs else None}]})


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("backups"); k.add_argument("--root", required=True)
    s = sub.add_parser("scan"); s.add_argument("--backup", required=True); s.add_argument("--password-env")
    e = sub.add_parser("extract"); e.add_argument("--backup", required=True); e.add_argument("--out", required=True)
    e.add_argument("--chats", required=True); e.add_argument("--media", action="store_true"); e.add_argument("--password-env")
    z = sub.add_parser("zip"); z.add_argument("--file", required=True); z.add_argument("--out"); z.add_argument("--me"); z.add_argument("--key")
    a = p.parse_args()
    if getattr(a, "out", None):
        os.makedirs(a.out, exist_ok=True)
    {"backups": cmd_backups, "scan": cmd_scan, "extract": cmd_extract, "zip": cmd_zip}[a.cmd](a)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except PermissionError:
        fail("no_access", NO_ACCESS)
    except Exception as err:  # noqa: BLE001
        fail("error", str(err))
