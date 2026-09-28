/**
 * 사람이 검수한 래스터 장면을 NewsCard HTML에 넣는 최소 헬퍼.
 * 원격 URL을 받지 않아 렌더가 네트워크 상태에 흔들리지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditorialIllustration = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderEditorialIllustration(dataUri, alt) {
    if (typeof dataUri !== 'string' ||
        !/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUri)) return '';
    return '<img class="editorial-illustration" src="' + dataUri +
      '" alt="' + escAttr(alt) + '">';
  }

  // 파일 시스템 오류는 카드 발송 실패가 아니라 SVG 폴백 사유다. readFile을 주입받아
  // Node 렌더러의 I/O와 브라우저용 마크업 생성을 분리한다.
  function loadEditorialDataUri(readFile, path) {
    // mime 을 png 로 박으면 webp 자산이 들어왔을 때 라벨이 거짓이 된다 —
    // 검증 정규식(png|webp)이 허용하는 두 형식을 확장자로 가른다.
    var mime = /\.webp$/i.test(String(path)) ? 'image/webp' : 'image/png';
    try {
      return 'data:' + mime + ';base64,' + readFile(path).toString('base64');
    } catch {
      return '';
    }
  }

  function loadEditorialIllustration(readFile, path, alt) {
    return renderEditorialIllustration(loadEditorialDataUri(readFile, path), alt);
  }

  return {
    renderEditorialIllustration: renderEditorialIllustration,
    loadEditorialDataUri: loadEditorialDataUri,
    loadEditorialIllustration: loadEditorialIllustration
  };
});
