"""Operator CLI:  python -m aw.cli <command>

  init-wallet              generate a new 24-word master seed (printed ONCE — write it down offline)
  import-wallet            import an existing 24-word seed (read from stdin)
  hot-wallets              show the hot-wallet (treasury) address of every network family
  add-admin <id> <role>    grant panel access (admin | finance | support | viewer)
  ledger-audit             verify every balance against the journal
  backup <file>            consistent online copy of the database
  seed-catalog             insert default networks/assets/methods (never overwrites edits)
"""
import getpass
import sys

from . import catalog, db, keys, ledger, treasury


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    db.conn()
    if cmd == "init-wallet":
        if keys.has_master():
            print("A master seed already exists — refusing to overwrite it.")
            return 1
        m = keys.generate_mnemonic()
        keys.save_mnemonic(m)
        print("\n================  MASTER RECOVERY PHRASE (24 words)  ================")
        for i, w in enumerate(m.split(), 1):
            print(f"{i:>2}. {w}", end="\n" if i % 4 == 0 else "\t")
        print("=====================================================================")
        print("Write these words on paper and keep them offline. They control ALL funds.")
        print("They will never be shown again by this tool.\n")
        return 0
    if cmd == "import-wallet":
        if keys.has_master():
            print("A master seed already exists — refusing to overwrite it.")
            return 1
        m = sys.stdin.readline().strip() if not sys.stdin.isatty() else getpass.getpass("24 words: ")
        if not keys.validate_mnemonic(m):
            print("Invalid recovery phrase.")
            return 1
        keys.save_mnemonic(m)
        print("Imported.")
        return 0
    if cmd == "hot-wallets":
        for fam, addr in treasury.hot_addresses().items():
            print(f"{fam:5} {addr}")
        return 0
    if cmd == "add-admin":
        uid, role = int(args[0]), args[1]
        db.x("INSERT INTO admins(user_id, role, created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role", (uid, role, db.now()))
        print("ok")
        return 0
    if cmd == "ledger-audit":
        bad = ledger.audit()
        print("OK — ledger consistent" if not bad else bad)
        return 0 if not bad else 2
    if cmd == "backup":
        db.backup(args[0])
        print("backup written:", args[0])
        return 0
    if cmd == "seed-catalog":
        catalog.seed()
        print("ok")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
