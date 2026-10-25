// A small slice of the real CRM master sheet (formatted text, as copied on 26 Oct 2026), for importer tests.
const bh = ['Sr No.','Series ','Floors','Wing','New Unit No.','Old Unit No.','Typology','Carpet Area Mtr.','Carpet Area Sf.ft','Parking ','Status','Allotment Date','Applicant 1','PAN','Aadhar No.','Applicant 2','PAN2','Aadhar No.2','Contact No.','Email ID','Address:','Address:2','Agreement Value','5% GST','SD','Reg','Market Value','Types of Ageement','Registration Date','Development C.','Funding Status','Bank NOC Date','Source','CP Firm Name','Brokerage Status','Bro. Amt. Released','Registration Status','Booking Form Received Date','Booking Form Received Month','Registration Difference','RM ','Audit Remark','ERP Entry','Receipt Shared','Registration Month'];
const b = (no, wing, floor, typ, sqm, sqft, park, status, allot, a1, pan, aad, a2, pan2, aad2, phone, email, ad1, ad2, av, gst, sd, reg, regDate, fund, noc, source, cp, bro, rm) =>
  ['', '', floor, wing, no, '', typ, sqm, sqft, park, status, allot, a1, pan, aad, a2, pan2, aad2, phone, email, ad1, ad2, av, gst, sd, reg, '', '', regDate, '', fund, noc, source, cp, bro, '', '', '', '', '', rm, '', '', '', ''];
const bookings = [bh,
  b('A-1001','A','10','2BHK','49.42','532','0','Sold','10-Aug-25','Rukhsana Soheb Shaikh','BUPPK5565A','6309 4979 0029','NA','NA','NA','9324213118','cuterukhsana1993@gmail.com','Raghvendra Mandir Road, Room No. 807, Rehab Building,','Gulshan Nagar, Jogeshwari West, Mumbai Maharashtra- 400102.','9715000','485750','485800','30000','8-May-26','Loan','HDFC Bank','Reference','Baddru Bhai','97150','Neha'),
  b('A-1002','A','10','1BHK','38.18','411','1','Sold','07-Jun-26','Abdul Ahad Abdul Hamid Shaikh','NNGPS7823M','6780 6541 6990','Sahroj Ahmed Abdul Hameed Shaikh','FFFPS4268H','2359 9006 2361','8108610967','ahadshaikh572@gmail.com/afrojshaikh100@gmail.com','Society No-25, Room No-12, Ganesh Nagar, Charkop, Near Oscar Hospital','Nilkhant Nagar, Mumbai, Maharashtra-400067.','7200000','360000','432000','30000','16-Jul-26','Self Funding','NA','Channel Partner','House of Inani','72000','Neha'),
  b('A-1003','A','10','1BHK','38.18','411','0','Available','','','','','','','','','','','','','0','0','',' ','','','','','0',''),
  b('A-1006','A','10','1BHK','38.18','411','0','Aslam/Management',' ','','','','','','','','','','','','0','0','',' ','','','','','0','Neha'),
  b('A-1007','A','10','3BHK','79.80','859','1','Allotment','13-Apr-25','Naved Rashid Khan','BDDPK9652D','6606 1703 1160','Yasmin Rashid Khan','GUCPK6596M','2759 8298 8141','9967294409','navedkhan_31@gmail.com','Amrut Nagar, Near Madni Baugh hall, Flat No.1, A-Wing, Kapadia Complex, ','Building No-22, Jogeshwari-West, Mumbai Maharashtra-400102.','15050000','752500','903000','30000',' ','Self Funding','NA','Channel Partner','The Investor Lobby','150500','Neha'),
  b('A-1008','A','10','3BHK','79.80','859','1','Allotment','13-Apr-25','Javed Rashid Khan','AOEPK4508F','3429 0574 3091','Yasmin Rashid Khan','GUCPK6596M','2759 8298 8141','9967294409','navedkhan_31@gmail.com','Flat No.1, A-Wing, Kapadia Complex, Building No-22,Amrut Nagar, Near Madni Baugh hall,','Jogeshwari-West, Mumbai Maharashtra-400102.','15050000','752500','903000','30000',' ','Self Funding','NA','Channel Partner','The Investor Lobby','150500','Neha'),
  b('A-1105','A','11','1BHK','38.18','411','0','Allotment','09-Aug-25','Mehaboobi','','','NM','','','9152403046','NM','','','7062000','353100','423800','',' ','','','','Prop Anchor','70620','Neha'),
  b('B-1001','B','10','2BHK','58.06','625','0','Sold','2-Sep-25','Aziz Ahmed Shaikh','EEUPS5327Q','6397 5853 9071','NA','NA','NA','9167045682','er.shaikhaziz@gmail.com','B-10, Walkenose Villa, Marol Maroshi Road, Near Uttam Da Dhaba, ','Marol, J.B. Nagar, Mumbai, Maharashtra-400059.','11738739','586937','704400','30000','5-Jun-26','LIC Finance','krishna','Channel Partner','House Of Inani ','117387.39',''),
];
const ch = ['Unit No.','Typology','Carpet Area Mtr.','Status','Primary Applicant','Contact No.','Booking Date','Reg Done','A.V Value','GST Amount','SDR Received','SDR Paid','SDR Difference','TDS','TDS Paid','TDS Due','Received In AV','Rece IN GST','Total Receive AV+TDS','Due %','Balance Due (AV)','GST Due','Funding Status','Remark','Registration Status','Booking Form Received Date','Status','GST Status','Wings','Demand Date','Demand Month'];
const c = (no, sdr, tds, recAv, recGst, due, remark, dd) => [no, '', '', '', '', '', '', '', '', '', sdr, '', '', '', tds, '', recAv, recGst, '', due, '', '', '', remark, '', '', '', '', no[0], dd, ''];
const crm = [ch,
  c('A-1001', '515800', '4858', '1943000', '  97,150.00 ', '20%', '29.08.26 Client will clear the TDS Due in Coming One week', '12-May-26'),
  c('A-1002', '462000', '72000', '1425600', '  72,000.00 ', '20%', '21.09.26 Calling done and TDS intimation given.', '15-July-26'),
  c('A-1003', '', '', '0', '  -   ', '20%', '', ''),
  c('A-1006', '', '', '0', '  -   ', '20%', '', ''),
  c('A-1007', '', '', '2982750', '  151,250.00 ', '20%', '15.09.26 DPC Deman Letter shared in Group', '21-July-26'),
  c('A-1008', '', '', '2982750', '  151,250.00 ', '20%', '15.09.26 DPC Deman Letter shared in Group', '21-July-26'),
  c('A-1105', '', '', '532301', '  -   ', '20%', '', ''),
  c('B-1001', '734324', '', '3521622', '  117,388.00 ', '30%', '22/10/26 GST will be paid BY november', '25-May-26'),
];
const L = (d, bank, inst, amt) => [d, bank, inst, amt];
const T = (h, amt) => [`Total Received against ${h}`, '', '', amt];
const ledger = [
  ['Flat No.', 'A-1001', 'Carpert Area:', '532'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'],
  L('14-Mar-2026', 'ICICI Bank', 'ICICR12026031409541350', '₹ 485,700'), L('16-Jul-2026', 'HDFC Bank', 'HDFCH01132342701', '₹ 1,457,300'), [], T('AV', '  1,943,000.00 '), [],
  L('30-Jun-2026', 'State Bank Of India', '21127', '₹ 4,858'), [], T('TDS ', '  4,858.00 '), [],
  L('14-Mar-2026', 'ICICI Bank', 'ICICR12026031409541350', '  24,288.00 '), L('16-Jul-2026', 'HDFC Bank', 'HDFCH01132342702', '₹ 72,862'), [], T('GST', '  97,150.00 '), [],
  L('27-May-2025', 'ICICI Bank', '514714536995', '  50,000.00 '), L('10-Aug-2025', 'ICICI Bank', '822015266678', '  100,000.00 '), L('17-Aug-2025', 'ICICI Bank', '52291532700', '  200,000.00 '), L('17-Aug-2025', 'HDFC Bank', '522915325393', '  50,000.00 '), L('10-Oct-2025', 'HDFC Bank', '112445971761', '  100,000.00 '), L('11-Oct-2025', 'ICICI Bank', 'ICICN12025101102988070', '  7,425.00 '), L('14-Mar-2026', 'ICICI Bank', 'ICICR12026031409541350', '  8,375.00 '), [], T('SDR', '  515,800.00 '),
  ['Flat No.', 'A-1002', 'Carpert Area:', '411'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'],
  L('7-Jun-2026', ' Saraswat Co-Operative Bank', '615427288006', '  10,000.00 '), L('11-Jun-2026', 'UCO Bank ', '000103', '  200,000.00 '), L('11-Jun-2026', 'Saraswat Co-Operative Bank', '616210318691', '  433,500.00 '), L('8-Jul-2026', 'Saraswat Co-Operative Bank', '218470', '  69,300.00 '), L('1-Aug-2026', 'Saraswat Co-Operative Bank', '219253', '  400,000.00 '), L('1-Aug-2026', 'Saraswat Co-Operative Bank', '219254', '  312,800.00 '), [], T('AV', '  1,425,600.00 '),
  L('20-Oct-2026', 'IDBI Bank', '000457', '  36,000.00 '), L('20-Oct-2026', 'IDBI Bank', '000471', '  36,000.00 '), T('TDS', '  72,000.00 '),
  L('2-Jul-2026', 'Kotak Mahindra Bank ', '618313981623', '  32,500.00 '), L('8-Jul-2026', 'Saraswat Co-Operative Bank', '218471', '3500'), L('1-Aug-2026', 'Saraswat Co-Operative Bank', '219255', '36000'), T('GST', '  72,000.00 '),
  L('2-Jul-2026', 'Kotak Mahindra Bank ', 'k811oclppyc9eyabvcha', '  420,000.00 '), L('8-Jul-2026', 'Saraswat Co-Operative Bank', '218472', '42000'), T('SDR', '  462,000.00 '),
  ['Flat No.', 'A-1003', 'Carpert Area:', '411'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'], T('AV', '  -   '), T('GST', '  -   '),
  ['Flat No.', 'A-1007', 'Carpert Area:', '859'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'],
  L('13-Apr-2025', 'HDFC Bank', '000104', '  100,000.00 '), L('9-Aug-2025', 'HDFC Bank', '522013067127', '  100,000.00 '), L('11-Aug-2025', 'HDFC Bank', '000106', '  250,000.00 '), L('29-Jan-2026', 'HDFC Bank', '000131', '  500,000.00 '), L('10-Mar-2026', 'HDFC Bank', '000132', '  550,000.00 '), L('9-Jul-2026', 'HDFC Bank', '000134', '  207,750.00 '), L('12-Aug-2026', 'HDFC Bank', '000107', '  600,000.00 '), L('17-Sep-2026', 'HDFC Bank', 'HDFCR52026091759955930', '  675,000.00 '), [], T('AV', '  2,982,750.00 '),
  L('9-Jul-2026', 'HDFC Bank', '000135', '  86,250.00 '), L('21-Sep-2026', 'HDFC Bank', 'HDFCH01274278257', '  65,000.00 '), T('GST', '  151,250.00 '),
  ['Flat No.', 'A-1008', 'Carpert Area:', '859'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'],
  L('13-Apr-2025', 'HDFC Bank', '000103', '  100,000.00 '), L('8-Aug-2025', 'HDFC Bank', '522013064566', '  100,000.00 '), L('11-Aug-2025', 'HDFC Bank', '000105', '  250,000.00 '), L('29-Jan-2026', 'HDFC Bank', '000130', '  500,000.00 '), L('10-Mar-2026', 'HDFC Bank', '000133', '  550,000.00 '), L('9-Jul-2026', 'HDFC Bank', '000134', '  207,750.00 '), L('12-Aug-2026', 'HDFC Bank', '000108', '  600,000.00 '), L('17-Sep-2026', 'HDFC Bank', 'HDFCR52026091759955930', '  675,000.00 '), [], T('AV', '  2,982,750.00 '),
  L('9-Jul-2026', 'HDFC Bank', '000135', '  86,250.00 '), L('21-Sep-2026', 'HDFC Bank', 'HDFCH01274278257', '  65,000.00 '), T('GST', '  151,250.00 '),
  ['Flat No.', 'A-1105', 'Carpert Area:', '411'], ['Date', 'Bank Name', 'Instrument No.', 'Amount'],
  L('9-Aug-2025', 'PhonePe', '522114473281', '13,000'), L('14-Aug-2025', 'PhonePe', '559252533888', '15,000'), L('5-Aug-2025', 'PhonePe', '558386127819', '40,000'), L('21-Sep-2026', 'State Bank of India', '955930', '2,30,000'), [], T('AV', '  298,000.00 '), T('GST', '  -   '),
];
const bank = [['Value Date', 'Description', 'Cheque No', 'Dr/Cr', ' INWARD ', 'OUTWARD', ' Running Total ', 'FLAT NO'],
  ['14-Mar-2026', 'x', '', '', '485700', '', '', 'A-1001'], ['16-Jul-2026', 'x', '', '', '1457300', '', '', 'A-1001'],
  ['1-Jan-2026', 'x', '', '', '50000', '', '', 'A-1006'], ['1-Jan-2026', 'x', '', '', '394772', '', '', 'SUSPENSE'], ['1-Jan-2026', 'x', '', '', '150000', '', '', 'A-1002'],
];
module.exports = { bookings, crm, ledger, bank };
