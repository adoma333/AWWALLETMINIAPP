// Windows: put the Zohra Wallet icon into the packaged .exe (pure JS resource editing — no wine needed on Linux CI).
// Usage: node stamp-icon.mjs "out/Zohra Wallet-win32-x64/Zohra Wallet.exe"
import fs from 'node:fs';
import path from 'node:path';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const target = process.argv[2];
const exe = PE.NtExecutable.from(fs.readFileSync(target), { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0]?.id ?? 1, groups[0]?.lang ?? 1033, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Zohra Wallet', FileDescription: 'Zohra Wallet', CompanyName: 'Zohra Wallet' });
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(target, Buffer.from(exe.generate()));
console.log('icon stamped into', path.basename(target));
