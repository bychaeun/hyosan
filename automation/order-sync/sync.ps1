# 수주현황판 자동 전송 — 업체 ERP DB(읽기 전용)에서 원본 수주현황판 조회를 그대로 실행해 효산 웹앱으로 보낸다.
# 작업 스케줄러가 10분마다 실행. 계정·전송 키는 %APPDATA%\hyosan-board 에 이 PC·이 윈도우 계정 전용으로 암호화 저장.
param([switch]$DryRun, [string]$OutFile)
$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:APPDATA 'hyosan-board'
$log = Join-Path $home_ 'sync.log'
$apiUrl = 'https://script.google.com/macros/s/AKfycbyiUawKvrT80mA7ClIg-WsBAKDg88sBwct8uasyn2R2o6ixLaM69eLEviyexyMTK_hv/exec'
function Log($msg) { $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Output $line }
function Unprotect($s) { (New-Object System.Net.NetworkCredential('', ($s | ConvertTo-SecureString))).Password }

try {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 512KB) { Move-Item $log "$log.old" -Force }
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  function Api($payload) { Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType 'text/plain; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6 -Compress))) -TimeoutSec 120 }
  if (-not $DryRun) {
    # 다른 PC가 8분 안에 이미 보냈으면 DB 조회 없이 끝낸다 (여러 PC 설치 시 중복 방지)
    $pushKey = Unprotect ((Get-Content (Join-Path $home_ 'push.json') -Raw | ConvertFrom-Json).key)
    $status = Api ([ordered]@{ action = 'orderBoardStatus'; secret = $pushKey })
    if ($status.ok -ne $true) { throw "웹앱 응답 오류: $($status.error)" }
    if ($status.updatedAt) {
      $age = ((Get-Date) - [datetime]::ParseExact($status.updatedAt.Substring(0, 19), 'yyyy-MM-ddTHH:mm:ss', $null)).TotalMinutes
      if ($age -ge 0 -and $age -lt 8) { Log ("건너뜀: 다른 PC가 {0:N0}분 전에 보냄" -f $age); exit 0 }
    }
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
  $cn.Close()

  $generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00'
  $board = [ordered]@{ locates = $locates; orders = $orders; worksheet = $worksheet; outwait = $outwait; todaylist = $todaylist; wkRemark = $wkRemark;
    sdrequest = $sdrequest; sdOut = $sdOut; icc = $icc; statecomp = $statecomp; locatesub = $locatesub; specColor = $specColor; stColor = $stColor }
  $summary = "수주 $($orders.Count)건 · 지역 $($locates.Count)개 · 작업지시 $($worksheet.Count) · 출고대기 $($outwait.Count)"

  if ($DryRun) {
    $target = if ($OutFile) { $OutFile } else { Join-Path $home_ 'board-preview.json' }
    [IO.File]::WriteAllText($target, (([ordered]@{ generatedAt = $generatedAt; board = $board }) | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
    Log "시험 실행 완료(전송 안 함): $summary -> $target"
    exit 0
  }

  $res = Api ([ordered]@{ action = 'orderBoardPush'; secret = $pushKey; generatedAt = $generatedAt; board = $board })
  if ($res.ok -ne $true) { throw "웹앱 응답 오류: $($res.error)" }
  Log ("전송 완료: $summary" + $(if ($res.skipped) { ' (다른 PC가 더 최신 데이터를 이미 보냄)' } elseif ($res.unchanged) { ' (내용 변화 없음)' } else { '' }))
} catch {
  Log ("실패: " + $_.Exception.Message)
  exit 1
}
