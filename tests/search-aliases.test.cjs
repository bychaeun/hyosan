const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.match(/function categorySearchAliases\(x\)\{[^\n]+/)[0];
const aliases=vm.runInNewContext(source+';categorySearchAliases');
test('Korean design synonyms cover both category fields and Korean source values',()=>{for(const [code,terms] of [['WOOD',['나무','목재','우드']],['SOLID',['단색','솔리드']],['MARBLE',['대리석','마블']],['STONE',['돌','석재','스톤']],['FABRIC',['직물','원단','패브릭']],['TEXTURE',['질감','텍스처','텍스쳐']],['TILE',['타일']]]){for(const field of ['Category','PrimaryCategory'])for(const term of terms)assert(aliases({[field]:code}).includes(term));assert(aliases({Category:terms[0]}).includes(code.toLowerCase()))}});
test('search aliases do not come from IDs or image URLs',()=>{assert.equal(aliases({LPM_ID:'WOOD',ImageURL:'https://example.com/WOOD'}),'')});
