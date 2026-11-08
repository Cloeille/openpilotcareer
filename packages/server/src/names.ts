// Names for the people the game makes up (market candidates, agency pilots, interims, the starter crew): the pool follows the country of the airport where the person is based.
// Every name is one Latin-script word (no space: `pilotNames` takes everything after the first space for the surname), romanized where the language has another script.
// Japanese, Chinese and Korean names keep the given-family order of the rest ("Haruto Sato", "Wei Zhang") so every name reads `First Last`.

type Pool = { countries: string; first: string; last: string };

const POOLS = {
  fr: {
    countries: 'FR MC GF GP MQ RE YT PM BL MF NC PF WF',
    first: 'Camille Lucas Léa Hugo Manon Louis Chloé Jules Inès Arthur Sarah Nathan Emma Théo Julie Antoine Clara Paul Zoé Maxime Alice Romain Lina Victor Yasmine Mathis Éloïse Samuel Gabriel Jeanne Raphaël Margaux Étienne Océane Baptiste Élise Quentin Pauline Thomas Anaïs Adrien Louise Benjamin Mélanie',
    last: 'Lefèvre Martin Bernard Dubois Moreau Laurent Simon Michel Garcia Roux Fournier Girard Bonnet Mercier Blanc Guérin Faure Rousseau Perrin Morel Giraud Andre Lemoine Chevalier Marchand Colin Benoit Renard Lambert Fontaine Vincent Muller Lopez Henry Gauthier Dupont Leroy Petit Robert Richard Durand Thomas Picard Barbier',
  },
  en: {
    countries: 'US GB CA AU NZ IE GG JE IM GI BM KY VG VI AI MS TC FK SH UM GU AS MP BS BB AG DM GD KN LC VC BZ GY JM TT NF CC CX CK NU',
    first: 'James Oliver Emily Charlotte Noah Liam Olivia Amelia Henry Jack Sophie Harry George Grace Lily William Thomas Ethan Mia Ava Daniel Matthew Hannah Chloe Ryan Megan Connor Aiden Isla Jacob Lucy Ben Zachary Natalie Owen Erin Declan Fiona Callum Rachel Dylan Nora',
    last: 'Smith Jones Taylor Brown Williams Wilson Johnson Davies Robinson Wright Thompson Evans Walker White Roberts Green Hall Wood Jackson Clarke Harris Lewis Young King Scott Baker Adams Campbell Mitchell Carter Murphy O\'Brien Kelly Walsh Ryan Anderson Miller Moore Cooper Reid Morgan Bennett Foster Hughes Stewart',
  },
  de: {
    countries: 'DE AT CH LI',
    first: 'Lukas Leon Hannah Finn Lena Jonas Mia Felix Emilia Paul Sophie Maximilian Anna Elias Marie Noah Laura Tim Johanna Moritz Katharina Jan Clara Niklas Lea Florian Julia Sebastian Nina Tobias Greta Matthias Anja Stefan Katrin Jürgen Ingrid Fabian Heike Dieter Sabine Klaus',
    last: 'Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Schäfer Koch Bauer Richter Klein Wolf Schröder Neumann Schwarz Zimmermann Braun Krüger Hofmann Hartmann Lange Schmitt Werner Krause Meier Lehmann Schmid Schulze Maier Köhler Herrmann König Walter Mayer Huber Kaiser Fuchs Peters',
  },
  es: {
    countries: 'ES MX AR CO CL PE VE EC UY PY BO CR PA GT HN SV NI CU DO PR GQ',
    first: 'Sofía Mateo Valentina Santiago Lucía Sebastián Martina Diego Camila Alejandro Isabella Javier Paula Carlos Daniela Andrés Carmen Pablo Elena Miguel Ana Adrián Marta Rodrigo Julia Fernando Gabriela Luis Natalia Ignacio Rosa Álvaro Valeria Joaquín Mariana Emilio Pilar Tomás Inés Cristian',
    last: 'García Rodríguez González Fernández López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Álvarez Romero Alonso Gutiérrez Navarro Torres Domínguez Vázquez Ramos Gil Ramírez Serrano Blanco Molina Castro Ortiz Rubio Marín Sanz Iglesias Medina Cortés Garrido Castillo Santos Lozano Vargas Rojas Mendoza Herrera',
  },
  pt: {
    countries: 'PT BR AO MZ CV GW ST TL',
    first: 'João Maria Pedro Ana Tiago Beatriz Miguel Inês Rafael Mariana Gonçalo Leonor Diogo Matilde Duarte Carolina Francisco Joana Bruno Catarina Rui Sofia Gabriel Larissa Thiago Fernanda Lucas Juliana Mateus Camila Vinícius Letícia Caio Bianca Renato Patrícia André Sílvia Eduardo Helena Henrique Raquel',
    last: 'Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Jesus Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes Soares Vieira Monteiro Cardoso Rocha Neves Coelho Cruz Cunha Pires Ramos Reis Simões Antunes Matos Fonseca Barbosa Araújo Lima',
  },
  it: {
    countries: 'IT SM VA MT',
    first: 'Francesco Sofia Leonardo Giulia Alessandro Aurora Lorenzo Alice Mattia Ginevra Andrea Chiara Gabriele Giorgia Riccardo Beatrice Tommaso Martina Edoardo Sara Matteo Elena Davide Valentina Federico Francesca Simone Silvia Luca Elisa Marco Anna Stefano Paola Giorgio Ilaria Enrico Roberta Vincenzo Claudia Salvatore Letizia',
    last: 'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone Longo Gentile Martinelli Vitale Lombardo Serra Coppola Marchetti Parisi Villa Fabbri Bellini',
  },
  nl: {
    countries: 'NL BE SR CW AW SX BQ',
    first: 'Daan Emma Sem Julia Lars Sophie Thijs Tess Bram Anna Jesse Lotte Milan Fleur Ruben Sanne Niels Eva Bart Iris Joris Noor Stijn Femke Wouter Lisa Koen Maud Sven Anouk Tim Marloes Pieter Floor Gerrit Liesbeth Jeroen Mirte Maarten Nienke Wout Lies',
    last: 'Jansen Bakker Visser Smit Meijer Mulder Bos Vos Peters Hendriks Dekker Brouwer Dijkstra Kok Jacobs Vermeulen Schouten Maas Willems Peeters Janssens Maes Claes Mertens Goossens Wouters Hermans Koster Kuijpers Postma Hoekstra Prins Veenstra Kramer Haas Verhoeven Wijnands Segers Wauters Declercq',
  },
  nordic: {
    countries: 'SE NO DK FI IS FO GL',
    first: 'Erik Astrid Lars Ingrid Anders Freja Mikael Sigrid Johan Elin Magnus Ida Henrik Maja Olav Linnea Nils Emma Anton Signe Jonas Saga Kasper Thea Rasmus Liv Sven Karin Mattias Helga Jukka Aino Mikko Kaisa Eero Sanna Bjørn Sólveig Gunnar Katrín',
    last: 'Andersson Johansson Hansen Nielsen Larsen Pedersen Olsen Svensson Karlsson Eriksson Lindqvist Berg Nilsson Jensen Christensen Rasmussen Sørensen Haugen Halvorsen Korhonen Virtanen Mäkinen Nieminen Hämäläinen Laine Heikkinen Koskinen Järvinen Gunnarsson Jónsson Sigurðsson Magnússon Dahl Lund Holm Strand Bergström Falk Ekström',
  },
  cee: {
    countries: 'PL CZ SK',
    first: 'Jan Katarzyna Piotr Agnieszka Tomasz Anna Paweł Magdalena Michał Zuzanna Jakub Marta Krzysztof Ewa Marek Petra Petr Lucie Martin Eliška Ondřej Tereza Lukáš Kateřina Jiří Veronika Miroslav Jana Peter Mária Juraj Zuzana Marcin Joanna Wojciech Aleksandra Adam Barbora Dominik Michaela Radek Monika',
    last: 'Nowak Kowalski Wiśniewski Wójcik Kowalczyk Kamiński Lewandowski Zieliński Szymański Woźniak Dąbrowski Kozłowski Novák Svoboda Novotný Dvořák Černý Procházka Kučera Veselý Horák Němec Marek Pospíšil Hájek Jelínek Kráľ Horváth Varga Baláž Kováč Tóth Molnár Mazur Krawczyk Piotrowski Grabowski Pawlak Zając',
  },
  ru: {
    countries: 'RU UA BY KZ MD',
    first: 'Aleksandr Dmitri Ivan Sergei Andrei Alexei Mikhail Nikolai Vladimir Pavel Anastasia Ekaterina Olga Natalia Tatiana Elena Svetlana Maria Irina Anna Yulia Oksana Viktor Igor Yuri Boris Maxim Artem Denis Roman Kirill Daria Polina Vera Larisa Galina Taras Bohdan Olena Iryna Anton Oleg',
    last: 'Ivanov Smirnov Kuznetsov Popov Sokolov Lebedev Kozlov Novikov Morozov Petrov Volkov Solovyov Vasiliev Zaitsev Pavlov Semyonov Golubev Vinogradov Bogdanov Fyodorov Mikhailov Belyaev Tarasov Belov Komarov Orlov Kiselyov Makarov Andreev Kovalenko Shevchenko Bondarenko Tkachenko Kovalchuk Boyko Melnyk Kravchenko Lysenko Savchenko Moroz Kuzmenko',
  },
  tr: {
    countries: 'TR AZ',
    first: 'Mehmet Ayşe Mustafa Fatma Ahmet Emine Ali Hatice Hüseyin Zeynep Hasan Elif Ibrahim Merve Murat Esra Emre Büşra Burak Selin Can Deniz Cem Derya Kerem Ceren Onur Gizem Eren Yasemin Serkan Pınar Tolga Seda Barış Aylin Volkan Melis Ozan Defne Kaan Leyla',
    last: 'Yılmaz Kaya Demir Çelik Şahin Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat Korkmaz Özer Çakır Erdoğan Yavuz Acar Şen Aksoy Güneş Aktaş Tekin Bozkurt Ateş Erdem Sarı Turan Güler Bulut Uçar Karaca',
  },
  ar: {
    countries: 'AE SA QA KW BH OM YE DZ MA TN LY MR EH JO LB SY IQ EG SD DJ SO KM',
    first: 'Mohammed Fatima Ahmed Aisha Omar Layla Khalid Noor Youssef Mariam Hassan Salma Ali Amira Ibrahim Yasmine Karim Rania Tariq Samira Nasser Hind Abdullah Huda Faisal Dina Mansour Lamia Sami Leila Walid Souad Rachid Nadia Hamza Malak Mehdi Zineb Bilal Imane Jamal Rim',
    last: 'Haddad Mansour Khalil Nasser Saleh Hamdan Suleiman Rahman Qasim Farouk Abbas Aziz Bakr Darwish Fahmy Habib Hakim Ismail Jaber Karimi Mahmoud Naser Othman Qureshi Rashid Sabri Tahir Yousef Zahran Benali Bouzid Cherif Trabelsi Amrani Alaoui Bennani Mansouri Khoury Nahas Salem Shehata Ghanem Sayegh Hijazi Almansoori Alketbi',
  },
  jp: {
    countries: 'JP',
    first: 'Haruto Yuito Sota Riku Hinata Yuna Sakura Mio Aoi Ren Kaito Daiki Takumi Haruka Misaki Yui Hana Kenji Hiroshi Takashi Akira Yuki Satoshi Kazuki Naoki Shota Ryota Yuma Emi Kaori Mai Nanami Rina Akari Ayaka Tomoko Masato Kenta Daichi Shun Noriko Reiko',
    last: 'Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Ishikawa Ogawa Goto Okada Hasegawa Murakami Kondo Ishii Saito Sakamoto Endo Aoki Fujita Nishimura Fukuda Ota Miura Fujii Okamoto',
  },
  zh: {
    countries: 'CN TW HK MO SG',
    first: 'Wei Fang Jun Lei Min Xin Yan Ying Ming Hao Jie Na Qiang Yong Tao Lin Yu Xiaoming Jing Mei Ling Hong Gang Bo Rui Kai Zhiwei Peng Ping Yun Hua Lan Shan Xiuying Jianguo Meiling Zihan Yuxuan Haoran Mingyu Siyu',
    last: 'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Gao Lin Luo Zheng Liang Xie Song Tang Han Feng Deng Cao Peng Zeng Xiao Tian Dong Pan Yuan Cai Jiang Du Ye Cheng Su Lu Ding Ren Chan Wong Cheung Lau Leung Tan Lim Ong Lee',
  },
  kr: {
    countries: 'KR KP',
    first: 'Minjun Seoyeon Jiho Seoah Junseo Jiwoo Hajun Haeun Doyun Yuna Siwoo Jiyu Eunwoo Suah Yejun Chaewon Jihoon Minseo Hyunwoo Subin Seungmin Jiwon Dohyun Yerin Taehyun Soyeon Jaehyun Eunji Sunwoo Hyejin Joonho Mina Kyungho Sooyoung Dongwoo Haneul Seojun Nayeon Youngho Jisoo',
    last: 'Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Yoo Hong Jeon Ko Moon Yang Son Bae Baek Heo Nam Shim Noh Ha Kwak Sung Cha Joo Woo Gu Min Na',
  },
  in: {
    countries: 'IN PK BD LK NP BT MV',
    first: 'Aarav Vivaan Aditya Arjun Rohan Ishaan Kabir Vihaan Rahul Amit Priya Ananya Diya Saanvi Aadhya Neha Pooja Kavya Riya Sneha Anjali Sunita Rajesh Suresh Vikram Sanjay Deepak Manish Anil Ravi Meera Lakshmi Divya Nikhil Karan Harpreet Gurpreet Imran Farhan Zainab Ayesha',
    last: 'Sharma Verma Gupta Singh Kumar Patel Shah Mehta Joshi Iyer Nair Reddy Rao Menon Pillai Das Bose Banerjee Chatterjee Mukherjee Kapoor Malhotra Khanna Chopra Bhatia Agarwal Jain Desai Kulkarni Patil Naidu Chaudhary Yadav Mishra Pandey Khan Ahmed Hussain Ali Sheikh Siddiqui',
  },
  sea: {
    countries: 'TH VN ID MY PH KH LA MM BN',
    first: 'Somchai Siriporn Anan Nattaya Kittipong Pimchanok Narong Malee Thanawat Ploy Minh Linh Anh Huong Tuan Lan Hieu Thao Duc Mai Quang Hoa Budi Siti Agus Dewi Rizky Putri Wayan Ayu Adi Rina Ahmad Nurul Hafiz Aisyah Farah Jose Angelica Mark Jasmine Ramon Cristina Joel Sokha Dara',
    last: 'Nguyen Tran Pham Hoang Huynh Vu Dang Bui Ngo Duong Saetang Srisai Chaiyaporn Wongsawat Boonmee Prasert Suwan Kaewkla Jaidee Rattana Wijaya Saputra Kusuma Santoso Hidayat Pratama Siregar Nugroho Hartono Abdullah Ismail Hassan Santos Reyes Cruz Bautista Garcia Mendoza Aquino Villanueva Ramos Lopez Chhay Sok',
  },
  africa: {
    countries: 'NG GH KE ZA ET TZ UG ZM ZW MW CM CI SN ML BF NE TD GN SL LR TG BJ GA CG CD RW BI MG MU SC NA BW LS SZ SS ER GM CF',
    first: 'Amara Kwame Thabo Chidi Fatou Kofi Zanele Tendai Ngozi Sipho Amina Kagiso Adebayo Chiamaka Mamadou Aïssatou Moussa Awa Ibrahima Mariama Samuel Grace Joseph Esther Daniel Ruth David Blessing Emmanuel Patience Yaw Ama Kwesi Abena Themba Lerato Nomvula Bongani Tariro Farai Wanjiru Kamau Achieng Otieno Juma Neema Baraka Hawa Salif',
    last: 'Okafor Mensah Ndlovu Nkosi Dlamini Mbeki Diallo Traoré Keita Konaté Coulibaly Sow Ndiaye Diop Fall Cissé Sanogo Adeyemi Balogun Okonkwo Eze Nwosu Abiola Asante Boateng Owusu Osei Mwangi Wanjiku Mutua Banda Moyo Sithole Khumalo Zulu Molefe Naidoo Pretorius Botha Tesfaye Bekele Abebe Mulugeta Kasongo Mukendi Kalala Okello Mugisha Kato',
  },
  gr: {
    countries: 'GR CY',
    first: 'Giorgos Maria Dimitris Eleni Nikos Katerina Yannis Sofia Kostas Anna Christos Georgia Panagiotis Despina Vasilis Ioanna Thanos Dimitra Michalis Evangelia Stavros Angeliki Alexandros Christina Manolis Irini Spyros Vasiliki Petros Alexandra Antonis Marina Stelios Konstantina Lefteris Fotini Pavlos Theodora Andreas Zoi',
    last: 'Papadopoulos Vlachos Georgiou Nikolaou Dimitriou Papadakis Pappas Athanasiou Karagiannis Oikonomou Makris Antoniou Vasileiou Konstantinou Ioannou Alexiou Lazaridis Papageorgiou Michailidis Stavrou Christodoulou Mavridis Kyriakou Papanikolaou Samaras Theodorou Angelopoulos Galanis Tsakalos Kalogeros Zervas Iliopoulos Economou Manolakis Bouras Charalambous Petrou Hadjis Kountouris Sarris Tzortzis',
  },
  // Every country the groups above do not name.
  intl: {
    countries: '',
    first: 'Alex Sam Maria Ana Daniel David Sara Laura Mark Anna Marco Eva Leo Nina Max Mia Ben Zoe Adam Lea Omar Lina Noah Eli Ida Ivan Jana Karim Lucas Maya Nico Olga Pablo Rosa Sofia Tom Vera Yuri Zara Ines Hugo Elena Jonas',
    last: 'Silva Costa Novak Kovacs Popescu Horvat Ionescu Petrov Nagy Stoica Marin Kovac Toth Varga Dumitru Georgiev Ivanovic Jovanovic Petrovic Nikolic Marino Radu Schwartz Cohen Levi Mizrahi Peretz Katz Kaplan Friedman Hakobyan Sargsyan Beridze Kapanadze Kazlauskas Jankauskas Berzins Kalnins Tamm Saar Mägi Ozols Petersen Ahmadi Karimi Rahimi',
  },
} satisfies Record<string, Pool>;

export type NameGroup = keyof typeof POOLS;

const words = (s: string): string[] => s.split(' ');
export const NAME_POOLS = Object.fromEntries(Object.entries(POOLS as Record<NameGroup, Pool>).map(([g, p]) => [g, { first: words(p.first), last: words(p.last) }])) as Record<NameGroup, { first: string[]; last: string[] }>;

const GROUP_OF = new Map<string, NameGroup>((Object.entries(POOLS as Record<NameGroup, Pool>) as [NameGroup, Pool][]).flatMap(([g, p]) => (p.countries ? words(p.countries).map((c): [string, NameGroup] => [c, g]) : [])));

/** The pool of an ISO 3166 country code (an airport's `country`); the international one when the country is unknown or has no pool of its own. */
export const nameGroupOf = (country: string | undefined): NameGroup => (country && GROUP_OF.get(country)) || 'intl';

/** "First Last" from the pool of `country`; the same `rand` always gives the same person. */
export function nameFrom(rand: () => number, country: string | undefined): string {
  const { first, last } = NAME_POOLS[nameGroupOf(country)];
  return `${first[Math.floor(rand() * first.length)]} ${last[Math.floor(rand() * last.length)]}`;
}
