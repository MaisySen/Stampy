import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Run the real TSX render paths with inert native views. No device, linking or network.
const jsx=(type,props)=>({type,props});
const jsxRuntime={jsx,jsxs:jsx,Fragment:'Fragment'};
const native={StyleSheet:{create:styles=>styles,absoluteFillObject:{}},Text:'Text',View:'View',TouchableOpacity:'Touch',ScrollView:'Scroll'};
const theme={colors:{},shared:{},spacing:{},type:{},gradientHero:['#000','#fff']};
function load(file,deps){
  const input=readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  const js=ts.transpileModule(input,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  runInNewContext(js,{exports,require(name){
    assert.ok(Object.hasOwn(deps,name),`Unexpected module ${name}`);return deps[name];
  }},{timeout:500});
  return exports;
}
const flatten=(n)=>Array.isArray(n)?n.flatMap(flatten):n&&typeof n==='object'?[n,...flatten(n.props?.children)]:typeof n==='string'?[n]:[];

for(const [os,platform,wallet] of [['android','google','Google Wallet'],['ios','apple','Apple Wallet']]) {
  test(`Wallet button opens an honest ${wallet} preview and returns`,()=>{
    const state=[];let hook=0;
    const react={useState(initial){const i=hook++;if(!Object.hasOwn(state,i))state[i]=initial;return [state[i],(v)=>{state[i]=v;}];}};
    const common={'react/jsx-runtime':jsxRuntime,'react-native':{...native,Platform:{OS:os}},react,'../theme':theme,'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'}};
    const data={demoBusiness:{name:'Test Coffee',reward:'Coffee'},demoCustomers:[],emptyBusiness:{},emptyCustomers:[],DEMO_STAFF_CODE:'0000',STAMPS_TO_REWARD:8,DEMO_BIRTHDAY:{month:1,day:1}};
    const {WalletScreen}=load('src/screens/WalletScreen.tsx',{...common,'../data':data,'../lib/loyalty':{daysUntilBirthday:()=>55,isBirthdayMonth:()=>false,isBirthdayToday:()=>false},'../components/StampCard':{StampCard:'Card'}});
    const {PassInstallScreen}=load('src/screens/PassInstallScreen.tsx',{...common,'../lib/pass':{passRewardState:()=> 'active',passStateLabel:()=> 'Active'}});
    const dt={...common,'expo-status-bar':{StatusBar:'StatusBar'},'./src/theme':theme,'./src/data':data,'./src/lib/fraud':{dayString:()=> 'today'},'./src/components/BottomNav':{BottomNav:'BottomNav'},'./src/screens/WalletScreen':{WalletScreen},'./src/screens/PassInstallScreen':{PassInstallScreen}};
    for(const name of ['StampScreen','AnalyticsScreen','ProgramScreen','PassBuilderScreen','LegalScreen'])dt['./src/screens/'+name]={[name]:name};
    const {default:App}=load('App.tsx',dt);
    const renderApp=()=>{hook=0;return flatten(App());};
    const entry=renderApp().find(n=>n.type===WalletScreen);assert.ok(entry);
    const button=flatten(WalletScreen(entry.props)).find(n=>n.props?.accessibilityLabel==='Preview Wallet pass');
    assert.equal(button?.props.accessibilityRole,'button');button.props.onPress();
    const screen=renderApp().find(n=>n.type===PassInstallScreen);assert.ok(screen);assert.equal(screen.props.platform,platform);
    const preview=flatten(PassInstallScreen(screen.props));const words=preview.filter(n=>typeof n==='string').join(' ').replace(/\s+/g,' ').trim();
    assert.match(words,new RegExp(`${wallet} preview`));assert.match(words,/preview only.*real signed pass/);
    assert.doesNotMatch(words,/pass added|one tap adds|scan this code|https:\/\//i);
    const actions=preview.filter(n=>n.props?.accessibilityRole==='button');assert.equal(actions.length,1);
    assert.equal(actions[0].props.onPress,screen.props.onClose);actions[0].props.onPress();
    assert.ok(renderApp().some(n=>n.type===WalletScreen));
  });
}
