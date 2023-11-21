SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

CREATE TABLE IF NOT EXISTS `_sobota` (
  `filename` varchar(25) NOT NULL,
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `_marcupdates` (
  `filename` varchar(40) NOT NULL,
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `systempreferences` (`variable`, `value`, `options`, `explanation`, `type`) VALUES
('Nukat_FTP_Host', '', NULL, 'Adres serwera FTP Nukat', 'Free'),
('Nukat_FTP_User_bn', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_ftpanalit', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_ftpbibnowe', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_ftpbibuser', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_ftpnowe', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_ftpuser', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_khasla', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_FTP_User_nukat', '', NULL, 'Hasło użytkownika ftp', 'Free'),
('Nukat_Library_Symbol', '', NULL, 'Symbol biblioteki w Nukat', 'Free');
('NukatSkrypty_Email_SenderName', 'Koha-Scripts', NULL, 'Wyświetlana nazwa nadawcy wiadomości e-mail', 'Free');
('NukatSkrypty_Email_Receiver', '', NULL, 'Odbiorcy adresów e-mail (oddzieleni średnikami)', 'Free');

COMMIT;
