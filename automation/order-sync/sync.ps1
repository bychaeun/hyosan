# 수주현황판 자동 전송 — 업체 ERP DB(읽기 전용)에서 원본 수주현황판 조회를 그대로 실행해 효산 웹앱으로 보낸다.
# 작업 스케줄러가 10분마다 실행. 계정·전송 키는 %APPDATA%\hyosan-board 에 이 PC·이 윈도우 계정 전용으로 암호화 저장.
param([switch]$DryRun, [string]$OutFile, [string[]]$Papers, [switch]$Force, [switch]$NewPapers, [switch]$ErpItems, [string]$ScanDir = 'E:\모양지이미지')   # -Papers: 시험 실행 때 재고 조회할 종이 넘버를 직접 지정 · -Force: 다른 PC가 방금 보냈어도 지금 보냄 · -NewPapers: 시험 실행 때 신규 종이도 조회 · -ScanDir: 종이 스캔 사진 폴더(대표 색)
$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:APPDATA 'hyosan-board'
$log = Join-Path $home_ 'sync.log'
$apiUrl = 'https://script.google.com/macros/s/AKfycbyiUawKvrT80mA7ClIg-WsBAKDg88sBwct8uasyn2R2o6ixLaM69eLEviyexyMTK_hv/exec'
function Log($msg) { $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Output $line }
function Unprotect($s) { (New-Object System.Net.NetworkCredential('', ($s | ConvertTo-SecureString))).Password }
# 스캔 사진의 대표 색: 80x80으로 줄여 k-평균(5묶음) 중 가장 넓은 색. 같은 파일(수정 시각 동일)은 scan-colors.json에 저장해 다시 계산하지 않는다.
$scanColors = $null; $scanColorsDirty = $false; $scanColorsFile = Join-Path $home_ 'scan-colors.json'
function ScanColor($path) {
  if ($script:scanColors -eq $null) {
    $script:scanColors = @{}
    if (Test-Path $scanColorsFile) { (Get-Content $scanColorsFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $script:scanColors[$_.Name] = $_.Value } }
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Collections.Generic; using System.Linq;
public static class ScanDominant {
  public static string Hex(string path){
    const int S=80,K=5; var px=new List<double[]>();
    using(var src=new Bitmap(path)) using(var bm=new Bitmap(S,S)){
      using(var g=Graphics.FromImage(bm)){g.InterpolationMode=InterpolationMode.HighQualityBilinear;g.DrawImage(src,0,0,S,S);}
      for(int y=0;y<S;y++)for(int x=0;x<S;x++){var c=bm.GetPixel(x,y);px.Add(new double[]{c.R,c.G,c.B});}
    }
    var sorted=px.OrderBy(p=>p[0]*0.299+p[1]*0.587+p[2]*0.114).ToList();
    var cen=new double[K][];for(int k=0;k<K;k++)cen[k]=(double[])sorted[(int)((k+0.5)*sorted.Count/K)].Clone();
    var lab=new int[px.Count];
    for(int it=0;it<15;it++){
      var sum=new double[K,3];var cnt=new int[K];
      for(int i=0;i<px.Count;i++){int best=0;double bd=double.MaxValue;for(int k=0;k<K;k++){double d=0;for(int j=0;j<3;j++){double t=px[i][j]-cen[k][j];d+=t*t;}if(d<bd){bd=d;best=k;}}lab[i]=best;cnt[best]++;for(int j=0;j<3;j++)sum[best,j]+=px[i][j];}
      for(int k=0;k<K;k++)if(cnt[k]>0)for(int j=0;j<3;j++)cen[k][j]=sum[k,j]/cnt[k];
    }
    var counts=new int[K];foreach(var l in lab)counts[l]++;
    var groups=new List<double[]>();   // 거의 같은 색 묶음(거리 18 미만)은 합친다
    foreach(var k in Enumerable.Range(0,K).OrderByDescending(k=>counts[k])){
      if(counts[k]==0)continue;
      var hit=groups.FirstOrDefault(gp=>Math.Sqrt(Math.Pow(gp[0]-cen[k][0],2)+Math.Pow(gp[1]-cen[k][1],2)+Math.Pow(gp[2]-cen[k][2],2))<18);
      if(hit!=null){double n=hit[3]+counts[k];for(int j=0;j<3;j++)hit[j]=(hit[j]*hit[3]+cen[k][j]*counts[k])/n;hit[3]=n;}
      else groups.Add(new double[]{cen[k][0],cen[k][1],cen[k][2],counts[k]});
    }
    var top=groups.OrderByDescending(gp=>gp[3]).First();
    return string.Format("#{0:X2}{1:X2}{2:X2}",(int)Math.Round(top[0]),(int)Math.Round(top[1]),(int)Math.Round(top[2]));
  }
}
'@
  }
  $key = $path + '|' + (Get-Item -LiteralPath $path).LastWriteTimeUtc.Ticks
  if (-not $script:scanColors.ContainsKey($key)) {
    try { $script:scanColors[$key] = [ScanDominant]::Hex($path); $script:scanColorsDirty = $true } catch { return '' }
  }
  $script:scanColors[$key]
}

try {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 512KB) { Move-Item $log "$log.old" -Force }
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  function Api($payload) { Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType 'text/plain; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 8 -Compress))) -TimeoutSec 120 }
  # 재고는 웹앱 시트(HYOSAN_LPM)에 있는 종이 넘버만 조회한다 — 목록은 상태 확인 때 함께 받는다
  $paperList = @()
  $pushFile = Join-Path $home_ 'push.json'
  if (-not $DryRun -or (Test-Path $pushFile)) {
    # 다른 PC가 8분 안에 이미 보냈으면 DB 조회 없이 끝낸다 (여러 PC 설치 시 중복 방지)
    $pushKey = Unprotect ((Get-Content $pushFile -Raw | ConvertFrom-Json).key)
    $status = Api ([ordered]@{ action = 'orderBoardStatus'; secret = $pushKey; papers = $true })
    if ($status.ok -ne $true) { throw "웹앱 응답 오류: $($status.error)" }
    if ($status.papers) { $paperList = @($status.papers) }
  }
  if ($DryRun -and $Papers) { $paperList = @($Papers | ForEach-Object { $_ -split ',' }) }
  if (-not $DryRun -and -not $Force -and $status.updatedAt) {
      $age = ((Get-Date) - [datetime]::ParseExact($status.updatedAt.Substring(0, 19), 'yyyy-MM-ddTHH:mm:ss', $null)).TotalMinutes
      if ($age -ge 0 -and $age -lt 8) { Log ("건너뜀: 다른 PC가 {0:N0}분 전에 보냄" -f $age); exit 0 }
  }
  $cred = Get-Content (Join-Path $home_ 'cred.json') -Raw | ConvertFrom-Json
  $csb = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $csb['Data Source'] = $cred.server; $csb['Initial Catalog'] = $cred.db
  $csb['User ID'] = $cred.user; $csb['Password'] = Unprotect $cred.pw
  $csb['Connect Timeout'] = 20; $csb['Application Name'] = 'HyosanOrderBoard-ReadOnly'
  $cn = New-Object System.Data.SqlClient.SqlConnection $csb.ConnectionString
  $cn.Open()

  # 값 변환: 날짜는 한국시간 ISO, 고정폭 문자 공백 제거, NULL 유지
  function Rows($sql) {
    $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
    $dt = New-Object System.Data.DataTable; [void](New-Object System.Data.SqlClient.SqlDataAdapter $cmd).Fill($dt)
    foreach ($r in $dt.Rows) {
      $o = [ordered]@{}
      foreach ($c in $dt.Columns) {
        $v = $r[$c]
        if ($v -is [DBNull]) { $v = $null }
        elseif ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00' }
        elseif ($v -is [string]) { $v = $v.Trim() }
        elseif ($v -is [decimal]) { $v = [double]$v }
        $o[$c.ColumnName] = $v
      }
      $o
    }
  }
  function InList($codes) { "'" + ((@($codes) | ForEach-Object { $_ -replace "'", "''" }) -join "','") + "'" }

  # 원본 수주현황판.scx um_loadstate 의 조회 (프로시저 sp_LoadOrderstate2 대신 같은 내용의 view_orderstate 사용)
  $locates = @(Rows "SELECT locate_code AS code, locate AS name FROM dbo.tb_locate WITH (NOLOCK) WHERE deleted = 0 ORDER BY locate_code")
  $orders = @(Rows ("SELECT locate_code, sj_code, tocomp_code, tocomp_short, comp_code, comp_short, item, pattern, spec_code, spec, st_code, standard, ord_qnty, out_qnty, cancel_time, express, order_time, ord_date, state, remark1" +
    " FROM dbo.view_orderstate WITH (NOLOCK) WHERE ord_qnty>0 and done_time is null and (cancel_time is null OR cancel_time > GETDATE()-1) and state<>'출고완료' ORDER BY tocomp_code, end_date, pattern, item"))   # ERP 화면 순서: 거래처 → 납기일 → 패턴
  $sjSet = @{}; foreach ($o in $orders) { $sjSet[$o.sj_code] = $true }
  $tocompSet = @{}; foreach ($o in $orders) { $tocompSet[$o.tocomp_code] = $true }

  $worksheet = @(Rows "SELECT sj_code, wk_code, stock_req, stock_wk, pd_req, mach_no, stock_done, end_time, cancel_time FROM dbo.tb_worksheet WITH (NOLOCK) WHERE ((pd_req>0 and end_time is null) or (stock_req>0 and stock_done is null)) and (deleted=0) ORDER BY sj_code, wk_code" |
    Where-Object { $sjSet.ContainsKey($_.sj_code) })
  $wkSet = @{}; foreach ($w in $worksheet) { $wkSet[$w.wk_code] = $true }
  $outwait = @(Rows ("select dbo.tb_order.sj_code, dbo.tb_outwait.seq, dbo.tb_outwait.out_code, dbo.tb_outwait.mode, dbo.tb_pdstock.wk_code" +
    ", (SELECT up_code FROM dbo.tb_unpaylist WITH (NOLOCK) WHERE dbo.tb_unpaylist.out_code = LEFT(dbo.tb_outwait.out_code,16) and deleted = 0) as up_code" +
    ", sum(dbo.tb_pdstock.qnty) as qnty FROM dbo.tb_order WITH (NOLOCK) left join dbo.tb_outwait WITH (NOLOCK) on dbo.tb_order.sj_code = dbo.tb_outwait.sj_code" +
    " left join dbo.tb_pdstock WITH (NOLOCK) on dbo.tb_pdstock.sj_code = dbo.tb_outwait.sj_code and dbo.tb_pdstock.sj_seq = dbo.tb_outwait.seq" +
    " WHERE dbo.tb_order.done_time is null and dbo.tb_order.cancel_time is null and dbo.tb_order.state<>'출고완료' and dbo.tb_order.deleted = 0 and dbo.tb_outwait.deleted = 0" +
    " GROUP BY dbo.tb_order.sj_code, dbo.tb_outwait.seq, dbo.tb_outwait.out_code, dbo.tb_outwait.mode, dbo.tb_pdstock.wk_code" +
    " UNION ALL SELECT dbo.tb_order.sj_code, 0 as seq, NULL as out_code, 1 as mode, dbo.tb_product.wk_code, null as up_code, dbo.tb_product.pd_qnty" +
    " FROM dbo.tb_order INNER JOIN dbo.tb_product ON dbo.tb_product.sj_code = dbo.tb_order.sj_code and dbo.tb_product.kubun=0 and dbo.tb_product.deleted = 0" +
    " WHERE dbo.tb_order.done_time is null and dbo.tb_order.cancel_time is null and dbo.tb_order.tocomp_code IN ('2-0820','000820') and dbo.tb_order.deleted = 0" +   # 재고 거래처 코드가 2-0820 → 000820 으로 바뀜 (실제 ERP 화면 기준)
    " ORDER BY 1,2,3,4,5,6,7") | Where-Object { $sjSet.ContainsKey($_.sj_code) -or ($_.wk_code -and $wkSet.ContainsKey($_.wk_code)) } |
    ForEach-Object { [ordered]@{ sj_code = $_.sj_code; mode = $_.mode; out_code = $_.out_code; up_code = $_.up_code; wk_code = $_.wk_code; qnty = $_.qnty } })
  $todaylist = @(Rows "SELECT id, tocomp_code, comp_code, CONVERT(char(10), today, 120) AS today, towhere FROM dbo.tb_todaylist ORDER BY id" | Where-Object { $tocompSet.ContainsKey($_.tocomp_code) })

  # 마지막 작업지시 비고 (수주별 가장 마지막 wk_code 의 remark)
  $wkRemark = [ordered]@{}
  Rows ("SELECT w.sj_code, w.wk_code, w.remark FROM dbo.tb_worksheet w WITH (NOLOCK) INNER JOIN dbo.tb_order o WITH (NOLOCK) ON w.sj_code = o.sj_code and w.deleted = 0" +
    " and (o.done_time is null) and (o.state<>'출고완료') and (o.ord_qnty>0) and ((o.cancel_time IS NULL) OR (o.cancel_time>=getdate()-1)) and (o.deleted = 0) ORDER BY w.sj_code, w.wk_code") |
    ForEach-Object { $wkRemark[$_.sj_code] = $_.remark }

  # 사급요청 건: 출고수량·ICC직출 수량 (원본 um_loadstate / um_addwk 모드 3)
  $sdrequest = @(Rows "SELECT DISTINCT sj_code FROM dbo.view_sdrequest WITH (NOLOCK) WHERE tocomp_code<>'009999' and done_time IS NULL and cancel_time IS NULL and state<>'출고완료'" | ForEach-Object { $_.sj_code } | Where-Object { $sjSet.ContainsKey($_) })
  $sdOut = [ordered]@{}; $icc = @()
  if ($sdrequest.Count) {
    Rows ("SELECT a.sj_code, ISNULL(SUM(a.out_qnty),0) AS out_qnty FROM dbo.tb_pdout a WITH (NOLOCK) INNER JOIN dbo.tb_unpaylist b WITH (NOLOCK) ON b.out_code = LEFT(a.out_code,16) and b.deleted = 0 WHERE a.sj_code IN (" + (InList $sdrequest) + ") and a.deleted = 0 GROUP BY a.sj_code") | ForEach-Object { $sdOut[$_.sj_code] = $_.out_qnty }
    $icc = @(Rows ("SELECT p.sj_code, p.out_qnty, (SELECT TOP 1 up_code FROM dbo.tb_unpaylist WITH (NOLOCK) WHERE out_code = LEFT(p.out_code,16) and deleted = 0) AS up_code FROM dbo.view_pdout p WITH (NOLOCK) WHERE p.sj_code IN (" + (InList $sdrequest) + ") and p.item_lot = 'ICC직출'"))
  }

  $statecomp = @(Rows "SELECT id, comp_code, tocomp_code, comp_short FROM dbo.view_statecomp WITH (NOLOCK) ORDER BY tocomp_code, id" | Where-Object { $tocompSet.ContainsKey($_.tocomp_code) })
  $locatesub = [ordered]@{}
  if ($tocompSet.Count) { Rows ("SELECT cust_code, locatesub FROM dbo.tb_customer WITH (NOLOCK) WHERE cust_code IN (" + (InList $tocompSet.Keys) + ")") | ForEach-Object { if ($_.locatesub) { $locatesub[$_.cust_code] = $_.locatesub } } }
  $specColor = [ordered]@{}; Rows "SELECT spec_code, bcolor FROM dbo.tb_spec WITH (NOLOCK)" | ForEach-Object { if ($_.bcolor -ne $null) { $specColor[$_.spec_code] = $_.bcolor } }
  $stColor = [ordered]@{}; Rows "SELECT st_code, fcolor FROM dbo.tb_standard WITH (NOLOCK)" | ForEach-Object { if ($_.fcolor -ne $null) { $stColor[$_.st_code] = $_.fcolor } }

  # 재고 (ERP 재고관리 > 원지 재고량 조정 · 제품재고량 조정): 시트에 있는 종이 넘버만
  #  원지: 남은 재고가 있는 롤의 재고 합계와 롤 수 / LPM: 아직 출고되지 않은 생산분 매수(사양·규격별)
  function PaperKey($v) { if ($v -eq $null) { return '' } ([string]$v).Normalize([Text.NormalizationForm]::FormKC).Trim() -replace '\s+', '' | ForEach-Object { $_.ToUpperInvariant() } }
  $paperSet = @{}; foreach ($p in $paperList) { $k = PaperKey $p; if ($k) { $paperSet[$k] = $true } }
  $stockPapers = [ordered]@{}; $stockLpm = [ordered]@{}
  if ($paperSet.Count) {
    Rows "SELECT pattern, COUNT(*) AS rolls, SUM(stock) AS stock FROM dbo.view_patternstock WITH (NOLOCK) WHERE stock<>0 AND ISNULL(nouse,0)=0 AND ISNULL(loose,0)=0 GROUP BY pattern" | ForEach-Object {
      $k = PaperKey $_.pattern; if ($paperSet.ContainsKey($k)) { $stockPapers[$k] = [ordered]@{ stock = $_.stock; rolls = $_.rolls } } }
    Rows "SELECT pattern, spec, standard, SUM(qnty) AS qnty FROM dbo.view_pdstock WITH (NOLOCK) WHERE out_code IS NULL AND qnty<>0 AND ISNULL(nouse,0)=0 GROUP BY pattern, spec, standard ORDER BY pattern, spec, standard" | ForEach-Object {
      $k = PaperKey $_.pattern
      if ($paperSet.ContainsKey($k)) { if (-not $stockLpm.Contains($k)) { $stockLpm[$k] = New-Object System.Collections.ArrayList }; [void]$stockLpm[$k].Add([ordered]@{ s = $_.spec; t = $_.standard; q = $_.qnty }) } }
  }
  $stock = [ordered]@{ papers = $stockPapers; lpm = $stockLpm }

  # 신규 종이(웹앱이 7일마다 newPapersDue로 알려줌): 최근 2년 입고된 종이 중 시트에 없는 것. 부자재(오버레이·크라프트·백페이퍼)는 뺀다.
  #  원지회사: 그 종이를 가장 많이 입고한 거래처(효산 자체 이동분 제외) · 색상: 스캔 폴더에 같은 이름 사진이 있으면 대표 색
  $paperCands = $null
  if ($paperSet.Count -and ($status.newPapersDue -or ($DryRun -and $NewPapers))) { try {   # 실패해도 수주현황판·재고 전송은 그대로 진행
    $paperCands = New-Object System.Collections.ArrayList
    $scan = @{}
    if (Test-Path -LiteralPath $ScanDir) { Get-ChildItem -LiteralPath $ScanDir -File | Where-Object { $_.Extension -match '^\.jpe?g$' } | ForEach-Object { $scan[(PaperKey $_.BaseName)] = $_.FullName } }
    Rows ("WITH ins AS (SELECT pattern_code, incomp_code, in_date AS d FROM dbo.tb_patternin WITH (NOLOCK) WHERE deleted=0" +
      " UNION ALL SELECT pattern_code, incomp_code, CAST(in_time AS date) FROM dbo.tb_patternstock WITH (NOLOCK))," +
      " recent AS (SELECT pattern_code, MIN(d) AS first_in, MAX(d) AS last_in, COUNT(*) AS lots FROM ins WHERE d>=DATEADD(year,-2,GETDATE()) GROUP BY pattern_code)," +
      " co AS (SELECT i.pattern_code, c.customer, ROW_NUMBER() OVER (PARTITION BY i.pattern_code ORDER BY COUNT(*) DESC, MAX(i.d) DESC) AS rk" +
      "  FROM ins i JOIN dbo.tb_customer c WITH (NOLOCK) ON c.cust_code=i.incomp_code WHERE c.customer NOT LIKE N'%효산%' GROUP BY i.pattern_code, c.customer)" +
      " SELECT p.pattern, ISNULL(co.customer,'') AS company, CONVERT(char(10),r.first_in,120) AS first_in, CONVERT(char(10),r.last_in,120) AS last_in, r.lots" +
      " FROM recent r JOIN dbo.tb_pattern p WITH (NOLOCK) ON p.pattern_code=r.pattern_code AND ISNULL(p.deleted,0)=0" +
      " LEFT JOIN co ON co.pattern_code=r.pattern_code AND co.rk=1 ORDER BY r.first_in") | ForEach-Object {
      $k = PaperKey $_.pattern
      if (-not $k -or $paperSet.ContainsKey($k) -or $_.pattern -match 'O/L|OVERLAY|KRAFT|BACK\s*PAPER|BACK$') { return }
      $img = $scan[$k]; if (-not $img) { $img = $scan[($k -replace '/', '')] }
      [void]$paperCands.Add([ordered]@{ paper = $_.pattern; company = $_.company; first = $_.first_in; last = $_.last_in; lots = $_.lots; color = $(if ($img) { ScanColor $img } else { '' }) })
    }
    if ($scanColorsDirty) { [IO.File]::WriteAllText($scanColorsFile, ($scanColors | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false))) }
  } catch { $paperCands = $null; Log ("신규 종이 조회 실패(다음 실행 때 다시 시도): " + $_.Exception.Message) } }

  # ERP 품목·비고(웹앱이 7일마다 erpItemsDue로 알려줌): 시트 종이의 품목(제품명·비고·스펙아웃)과 종이·인덱스 비고 → 'ERP 품목' 시트와 '내용'의 [ERP] 줄
  $erpItemRows = $null
  if ($paperSet.Count -and ($status.erpItemsDue -or ($DryRun -and $ErpItems))) { try {   # 실패해도 수주현황판·재고 전송은 그대로 진행
    $inSheet = { param($v) $k = PaperKey $v; $k -and $paperSet.ContainsKey($k) }
    $erpItemRows = New-Object System.Collections.ArrayList; $erpPaperRows = New-Object System.Collections.ArrayList; $erpIndexRows = New-Object System.Collections.ArrayList
    Rows ("WITH sale AS (SELECT item_code, MAX(reg_date) AS d FROM dbo.tb_salelist WITH (NOLOCK) WHERE deleted=0 GROUP BY item_code)" +
      " SELECT p.pattern, i.item_code, ISNULL(i.item,'') AS item, ISNULL(i.smplbook_id,'') AS book, ISNULL(i.specout,'') AS specout, ISNULL(i.remark,'') AS remark," +
      " ISNULL(CONVERT(char(10),i.first_time,120),'') AS made, ISNULL(CONVERT(char(10),s.d,120),'') AS last_sale" +
      " FROM dbo.tb_item i WITH (NOLOCK) JOIN dbo.tb_pattern p WITH (NOLOCK) ON p.pattern_code=i.pattern_code AND ISNULL(p.deleted,0)=0 LEFT JOIN sale s ON s.item_code=i.item_code WHERE ISNULL(i.deleted,0)=0") | ForEach-Object {
      if (& $inSheet $_.pattern) { [void]$erpItemRows.Add([ordered]@{ paper = ([string]$_.pattern).Trim(); code = ([string]$_.item_code).Trim(); name = ([string]$_.item).Trim(); book = ([string]$_.book).Trim(); specout = ([string]$_.specout).Trim(); remark = [string]$_.remark; made = $_.made; lastSale = $_.last_sale }) }
    }
    Rows "SELECT pattern, LTRIM(RTRIM(ISNULL(remark,'')+' '+ISNULL(remark2,''))) AS remark FROM dbo.tb_pattern WITH (NOLOCK) WHERE ISNULL(deleted,0)=0 AND LTRIM(RTRIM(ISNULL(remark,'')+ISNULL(remark2,'')))<>''" | ForEach-Object {
      if (& $inSheet $_.pattern) { [void]$erpPaperRows.Add([ordered]@{ paper = ([string]$_.pattern).Trim(); remark = [string]$_.remark }) }
    }
    Rows ("SELECT p.pattern, ISNULL(x.ptn_name,'') AS name, ISNULL(CONVERT(char(10),x.spec_out,120),'') AS spec_out, ISNULL(x.remark,'') AS remark FROM dbo.tb_indexlist x WITH (NOLOCK)" +
      " JOIN dbo.tb_item i WITH (NOLOCK) ON i.item_code=x.item_code JOIN dbo.tb_pattern p WITH (NOLOCK) ON p.pattern_code=i.pattern_code WHERE ISNULL(x.deleted,0)=0 AND (x.spec_out IS NOT NULL OR ISNULL(x.remark,'')<>'')") | ForEach-Object {
      if (& $inSheet $_.pattern) { [void]$erpIndexRows.Add([ordered]@{ paper = ([string]$_.pattern).Trim(); name = ([string]$_.name).Trim(); specOut = $_.spec_out; remark = [string]$_.remark }) }
    }
  } catch { $erpItemRows = $null; Log ("ERP 품목 조회 실패(다음 실행 때 다시 시도): " + $_.Exception.Message) } }
  $cn.Close()

  $generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00'
  $board = [ordered]@{ locates = $locates; orders = $orders; worksheet = $worksheet; outwait = $outwait; todaylist = $todaylist; wkRemark = $wkRemark;
    sdrequest = $sdrequest; sdOut = $sdOut; icc = $icc; statecomp = $statecomp; locatesub = $locatesub; specColor = $specColor; stColor = $stColor }
  $summary = "수주 $($orders.Count)건 · 지역 $($locates.Count)개 · 작업지시 $($worksheet.Count) · 출고대기 $($outwait.Count) · 재고 종이 $($stockPapers.Count)/LPM $($stockLpm.Count) (시트 종이 넘버 $($paperSet.Count))"

  if ($DryRun) {
    $target = if ($OutFile) { $OutFile } else { Join-Path $home_ 'board-preview.json' }
    if ($erpItemRows -ne $null) { $summary += " · ERP 품목 $($erpItemRows.Count) · 종이 비고 $($erpPaperRows.Count) · 인덱스 $($erpIndexRows.Count)" }
    [IO.File]::WriteAllText($target, (([ordered]@{ generatedAt = $generatedAt; board = $board; stock = $stock; newPapers = $paperCands; erpItems = $erpItemRows; erpPaperRemarks = $erpPaperRows; erpIndex = $erpIndexRows }) | ConvertTo-Json -Depth 7 -Compress), (New-Object Text.UTF8Encoding($false)))
    if ($paperCands -ne $null) { $summary += " · 신규 종이 후보 $($paperCands.Count)" }
    Log "시험 실행 완료(전송 안 함): $summary -> $target"
    exit 0
  }

  $payload = [ordered]@{ action = 'orderBoardPush'; secret = $pushKey; generatedAt = $generatedAt; board = $board }
  if ($paperSet.Count) { $payload.stock = $stock }   # 목록을 못 받았으면 재고는 보내지 않아 이전 재고를 지우지 않는다
  $res = Api $payload
  if ($res.ok -ne $true) { throw "웹앱 응답 오류: $($res.error)" }
  Log ("전송 완료: $summary" + $(if ($res.skipped) { ' (다른 PC가 더 최신 데이터를 이미 보냄)' } elseif ($res.unchanged) { ' (내용 변화 없음)' } else { '' }))
  if ($paperCands -ne $null) {
    try {
      $np = Api ([ordered]@{ action = 'newPapersPush'; secret = $pushKey; papers = @($paperCands) })
      if ($np.ok -ne $true) { throw $np.error }
      Log "신규 종이: 후보 $($np.received) · 시트에 추가 $($np.added) · 이미 옮겨져 지움 $($np.removed)"
    } catch { Log ("신규 종이 전송 실패(다음 실행 때 다시 시도): " + $_.Exception.Message) }
  }
  if ($erpItemRows -ne $null) {
    try {
      $ei = Api ([ordered]@{ action = 'erpItemsPush'; secret = $pushKey; items = @($erpItemRows); paperRemarks = @($erpPaperRows); index = @($erpIndexRows) })
      if ($ei.ok -ne $true) { throw $ei.error }
      Log ("ERP 품목: $($ei.items)개 · '내용' 바뀐 종이 $($ei.notesChanged)" + $(if ($ei.specOutCreated) { ' · SpecOut 칸 새로 만듦' } else { '' }))
    } catch { Log ("ERP 품목 전송 실패(다음 실행 때 다시 시도): " + $_.Exception.Message) }
  }
} catch {
  Log ("실패: " + $_.Exception.Message)
  exit 1
}
