<#
 =============================================================================
  Module   : Cloud of Things - FloodWatch (Sup'Com 2026-2027)
  Fichier  : backend/deploy/scripts/dns-hosts.ps1
  Equipe   : FloodWatch - Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed
  Version  : 1.0 - 2026-11-14
  Role     : equivalent Windows de dns-hosts.sh. Ecrit les quatre noms de
             service FloodWatch dans le fichier hosts de Windows.
             A privilegier sous Windows : le suffixe « .local » est reserve au
             mDNS, et le resolveur du systeme court-circuite souvent un vrai
             serveur DNS pour ce suffixe.
  Usage    : ouvrir PowerShell EN ADMINISTRATEUR, puis
               .\scripts\dns-hosts.ps1
               .\scripts\dns-hosts.ps1 -Domain floodwatch.local -Ip 127.0.0.1
               .\scripts\dns-hosts.ps1 -Remove
 =============================================================================
#>
[CmdletBinding()]
param(
    [string] $Domain = 'floodwatch.local',
    [string] $Ip     = '127.0.0.1',
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'
$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
$mark      = "# FloodWatch ($Domain)"

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script modifie $hostsFile : relancez PowerShell en tant qu'administrateur."
}

Copy-Item $hostsFile "$hostsFile.bak" -Force
$kept = Get-Content $hostsFile | Where-Object { $_ -notmatch [regex]::Escape($mark) }

if ($Remove) {
    Set-Content -Path $hostsFile -Value $kept -Encoding ascii
    Write-Output ">> Entrees de $Domain retirees de $hostsFile (sauvegarde .bak)"
    return
}

$names = @($Domain, "www.$Domain", "admin.$Domain", "api.$Domain", "iam.$Domain", "mqtt.$Domain")
$added = $names | ForEach-Object { "{0}`t{1}`t{2}" -f $Ip, $_, $mark }
Set-Content -Path $hostsFile -Value ($kept + $added) -Encoding ascii

Write-Output ">> $Domain : $($names.Count) noms ajoutes dans $hostsFile vers $Ip"
Write-Output "   https://www.$Domain/    front-office (citoyen)"
Write-Output "   https://admin.$Domain/  back-office (pilotage)"
Write-Output "   https://api.$Domain/    API REST et WebSocket"
Write-Output "   https://iam.$Domain/    authentification"
