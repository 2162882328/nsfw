/*
 * ASMR.ONE - subtitle-priority source for HentaiPark 0.13.1
 * Experimental plugin, version 0.1.0.
 * API compatibility and real playback are not yet verified.
 */
(() => {
  const SITE = 'https://asmr.one';
  const API = 'https://api.asmr-300.com';
  const allowedAudio = new Set([
    'mp3', 'm4a', 'mp4', 'ogg', 'oga',
    'flac', 'wav', 'aac', 'opus', 'webm'
  ]);
  const allowedSubtitle = new Set([
    'lrc', 'srt', 'vtt', 'ass', 'ssa'
  ]);

  const clean = text =>
    String(text == null ? '' : text).trim();

  const ext = name =>
    clean(name).split('?')[0].split('#')[0]
      .split('.').pop().toLowerCase();

  const rid = input => {
    const match = /^(?:RJ)?(\d{5,12})$/i.exec(clean(input));
    if (!match) {
      throw Park.error('NOT_FOUND', '作品编号无效');
    }
    return match[1];
  };

  const publicUrl = (input, base = API) => {
    if (!input || typeof input !== 'string') return '';
    try {
      const url = new URL(input, base);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i
          .test(url.hostname) ||
        /(^|\.)(localhost|local)$/.test(url.hostname)
      ) return '';
      return url.href;
    } catch (_) {
      return '';
    }
  };

  const cover = (obj, id) =>
    publicUrl(
      obj.mainCoverUrl ||
      obj.coverUrl ||
      obj.cover ||
      obj.main_cover_url ||
      (id ? API + '/api/cover/' + id + '.jpg' : ''),
      SITE
    );

  const itemId = obj => {
    const raw =
      obj.source_id ||
      obj.sourceId ||
      obj.id ||
      obj.rj ||
      obj.RJ ||
      obj.code ||
      obj.workId;

    const match = /(?:RJ)?(\d{5,12})/i.exec(clean(raw));
    return match ? match[1] : '';
  };

  const subtitleName = name =>
    /(中[文字幕]|汉化|漢化|简体|繁體|繁体|chinese|zh[-_]?cn|zh[-_]?tw)/i
      .test(name);

  const normalizeList = value => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];

    for (const entry of [
      value.works,
      value.data,
      value.results,
      value.items,
      value.list,
      value.records,
      value.data?.works,
      value.data?.data
    ]) {
      if (Array.isArray(entry)) return entry;
    }
    return [];
  };

  const result = obj => {
    const id = itemId(obj);
    if (!id) return null;

    const title = clean(
      obj.title ||
      obj.name ||
      obj.title_ja ||
      obj.name_ja ||
      'RJ' + id
    );

    const authors = [
      obj.circle?.name ||
      obj.circle_name ||
      obj.circleName
    ].filter(Boolean).map(clean);

    return {
      id,
      title,
      cover: cover(obj, id),
      mediaKind: 'voice',
      coverAspect: 1,
      workCode: 'RJ' + id,
      authors
    };
  };

  const parseNodes = (tree, limit = 2500) => {
    const nodes = new Map();
    const folders = new Map();

    function append(items, depth, path) {
      if (
        !Array.isArray(items) ||
        depth > 18 ||
        nodes.size > limit
      ) return [];

      const here = [];

      for (let i = 0; i < items.length; i++) {
        const source = items[i];
        if (!source || typeof source !== 'object') continue;

        const position = path
          ? path + '.' + i
          : String(i);

        const type = clean(source.type).toLowerCase();
        const name = clean(
          source.title || source.name || '未命名'
        );

        const suffix = ext(name);

        const isFolder =
          type === 'folder' ||
          (
            Array.isArray(source.children) &&
            source.children.length > 0
          );

        const media = publicUrl(
          source.mediaDownloadUrl ||
          source.mediaStreamUrl ||
          source.streamUrl ||
          source.url
        );

        if (isFolder) {
          const id = 'dir:' + position;

          const folder = {
            id,
            name,
            type: 'directory'
          };

          nodes.set(id, folder);
          here.push(folder);

          folders.set(
            id,
            append(source.children, depth + 1, position)
          );

          continue;
        }

        if (!media) continue;

        const kind =
          (type === 'audio' || allowedAudio.has(suffix))
            ? 'audio'
            : (
              (type === 'text' || type === 'subtitle') &&
              allowedSubtitle.has(suffix)
            )
              ? 'subtitle'
              : '';

        if (!kind) continue;

        const id =
          (kind === 'subtitle' ? 'sub:' : 'audio:') +
          position;

        const node = {
          id,
          name,
          type: kind,
          url: media,
          format: suffix ||
            (kind === 'audio' ? 'mp3' : 'vtt')
        };

        if (kind === 'subtitle') {
          node.subtitleLanguage = subtitleName(name)
            ? 'zh'
            : /japanese|jp|日本語/i.test(name)
              ? 'ja'
              : undefined;
        }

        nodes.set(id, node);
        here.push({ ...node });
      }

      const audios = here.filter(
        n => n.type === 'audio'
      );

      const subtitles = here.filter(
        n => n.type === 'subtitle'
      );

      for (const audio of audios) {
        const stem = audio.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase();

        const attached = subtitles.filter(s => {
          const subStem = s.name
            .replace(/\.[^.]+$/, '')
            .toLowerCase();

          return (
            subStem.includes(stem) ||
            stem.includes(subStem) ||
            audios.length === 1
          );
        });

        if (attached.length) {
          audio.subtitleIds = attached.map(s => s.id);
        }
      }

      return here;
    }

    folders.set('_', append(tree, 0, ''));

    return { nodes, folders };
  };

  Park.register({
    key: 'asmrone_zh',
    name: 'ASMR.ONE · 字幕优先',
    version: '0.1.0',
    minAppVersion: '0.13.0',

    type: 'voice',
    category: 'asmr',
    color: '#936399',

    description:
      'ASMR.ONE 多轨音声；优先筛选附字幕作品，不保证每部都有中文字幕',

    homepage: SITE,
    domains: [
      'asmr.one',
      'asmr-300.com',
      'asmr-200.com'
    ],

    network: {
      mode: 'auto',
      vpnHint: true,
      origin: SITE,
      headers: {
        Accept: 'application/json',
        Referer: SITE + '/',
        Origin: SITE
      }
    },

    media: {
      mode: 'native',
      scope: 'session',
      origin: SITE
    },

    defaultFeed: 'subtitled',

    feeds: [
      {
        key: 'subtitled',
        label: '附字幕作品',
        options: [{
          key: 'sort',
          label: '排序',
          default: 'latest',
          values: [
            { value: 'latest', label: '最新' },
            { value: 'popular', label: '热门' }
          ]
        }]
      },
      {
        key: 'all',
        label: '全部作品',
        options: [{
          key: 'sort',
          label: '排序',
          default: 'latest',
          values: [
            { value: 'latest', label: '最新' },
            { value: 'popular', label: '热门' }
          ]
        }]
      }
    ],

    searchFilters: [{
      key: 'subtitle',
      label: '字幕',
      default: 'yes',
      values: [
        { value: 'yes', label: '仅附字幕' },
        { value: 'all', label: '不限' }
      ]
    }],

    idPattern: '^RJ[0-9]{5,12}$',
    idExample: 'RJ01037721',

    linkPatterns: [
      'asmr\\.one/work/(?:RJ)?([0-9]{5,12})'
    ],

    async api(path, params) {
      const response = await this.http.get(
        API + path,
        { params }
      );

      if (response.status === 404) {
        throw Park.error(
          'NOT_FOUND',
          '作品不存在'
        );
      }

      if (!response.ok) {
        throw Park.error(
          'HTTP',
          'HTTP {status}',
          {
            status: response.status,
            params: { status: response.status }
          }
        );
      }

      try {
        return response.json();
      } catch (_) {
        throw Park.error(
          'PARSE',
          '作品数据格式无效'
        );
      }
    },

    async collection(request, keyword, withSubtitle) {
      const page = Math.max(
        1,
        Math.floor(Number(request?.page) || 1)
      );

      const sort =
        request?.filters?.sort ||
        request?.options?.sort ||
        'latest';

      const opts = {
        order: sort === 'popular'
          ? 'dl_count'
          : 'create_date',
        sort: 'desc',
        page,
        pageSize: 20,
        subtitle: withSubtitle ? 1 : 0,
        includeTranslationWorks: true
      };

      const raw = keyword
        ? await this.api(
            '/api/search/' +
            encodeURIComponent(keyword),
            opts
          )
        : await this.api(
            '/api/works',
            { ...opts, seed: 67 }
          );

      const entries = normalizeList(raw);

      const items = entries
        .map(result)
        .filter(Boolean);

      const pages = Number(
        raw?.pagination?.totalPages ||
        raw?.pagination?.last_page ||
        raw?.totalPages ||
        raw?.total_pages ||
        0
      );

      const total = Number(
        raw?.pagination?.totalCount ||
        raw?.total ||
        0
      );

      const hasNext = pages
        ? page < pages
        : total
          ? page * 20 < total
          : entries.length >= 20;

      return { items, page, hasNext };
    },

    async feed(key, request) {
      if (!['subtitled', 'all'].includes(key)) {
        throw Park.error(
          'CONFIG',
          '未知列表'
        );
      }

      return this.collection(
        request,
        '',
        key === 'subtitled'
      );
    },

    async search(request) {
      const keyword = clean(request.keyword);

      if (!keyword) {
        return {
          items: [],
          page: 1,
          hasNext: false
        };
      }

      return this.collection(
        request,
        keyword,
        request?.filters?.subtitle !== 'all'
      );
    },

    async work(id) {
      const n = rid(id);

      const raw = await this.api(
        '/api/workInfo/' + n
      );

      Const info = 没有?.work || 没有?.时间 || 没有;

      如果 (!info || typeof info !== 'object') {
        扔 公园.误差(
          现在,我们要做些什么呢?,
          '作品信息无效'
        );
      }

      return { n, info };
    },

    异步 detail(身份标识, preview) {
      Const { n, info } = 等候 这.work(身份标识);

      return {
        身份标识: n,
        title: clean(
          info.title ||
          preview?.title ||
          'RJ' + n
        ),
        cover: cover(info, n),
        mediaKind: 'voice',
        workCode: 'RJ' + n,
        url: 地点 + '/work/RJ' + n,
        作者: [
          info.circle?.name ||
          info.circle_name ||
          info.circleName
        ].过滤器(Boolean).map(干净的),
        描述: 干净的(
          info.描述 || info.intro || ''
        ),
        voiceRoot: {
          身份标识: '_',
          name: 干净的(info.标题 || 'RJ' + n),
          类型: 'directory'
        }
      };
    },

    异步 树(身份标识) {
      Const n = 使摆脱(身份标识);

      Const 没有 = 等候 这.api(
        '/api/tracks/' + n,
        { v: 2 }
      );

      Const 列表 = 现在.没有(没有)
        ? 没有
        : (
          现在.没有(没有?.时间)
            ? 没有.时间
            : 没有?.轨迹
        );

      如果 (!现在.没有(列表)) {
        扔 公园.误差(
          现在,我们要做些什么呢?,
          "音轨数据无效"
        );
      }

      return 它们是(列表);
    },

    异步语音目录(身份标识, 目录, 选项 = {}) {
      Const 树 = 等候 这.树(身份标识);
      Const 项目 = 树.文件夹.得到(目录);

      如果 (!项目) {
        扔 公园.误差(
          '未找到(_F)',
          '音轨目录不存在'
        );
      }

      Const 页 = 没有.最大值(
        1,
        数学.底板(数量(选项.页) || 1)
      );

      Const 大小 = 100;

      return {
        项目: 项目.片(
          (页 - 1) * 大小,
          页 * 大小
        ),
        已经: 页 * 大小 < 项目.长度
      };
    },

    异步voiceResource(身份标识, nodeID) {
      Const 节点 = (
        等候 这.树(身份标识)
      ).节点.得到(nodeID);

      如果 (
        !节点 ||
        !['音频', '字幕'].包括(节点.类型)
      ) {
        扔 公园.误差(
          '未找到(_F)',
          '音频或字幕不存在'
        );
      }

      return {
        url: 节点.url,
        格式: 节点.格式
      };
    },

    异步 视频(身份标识, sectialId) {
      Const 节点 = (
        等候 这.树(身份标识)
      ).节点.得到(sectialId);

      如果 (!节点 || 节点.类型 !== '音频') {
        扔 公园.误差(
          '未找到(_F)',
          '音轨不存在'
        
      }

      返回 [{
        URL: 节点.URL,
        格式: 节点.格式,
        标签: '原始音轨',
        优先的: 正确,
        页眉: {
          Referer: 地点 + '/'
        }
      }];
    }
  });
})();
