import {copyFile, mkdir, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=join(root,'dist');
await mkdir(join(dist,'assets'),{recursive:true});
await mkdir(join(dist,'.well-known'),{recursive:true});
await copyFile(join(root,'.well-known','assetlinks.json'),join(dist,'.well-known','assetlinks.json'));
for(const name of ['index.html','sw.js','privacy.html','manifest.webmanifest','mobile.webmanifest']){
  await copyFile(join(root,name),join(dist,name));
}
for(const entry of await readdir(join(root,'assets'),{withFileTypes:true})){
  if(entry.isFile())await copyFile(join(root,'assets',entry.name),join(dist,'assets',entry.name));
}
console.log('Static distribution synchronized with source.');
